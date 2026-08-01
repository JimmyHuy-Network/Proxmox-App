import type { EndpointRuntime, PveHttpMethod } from './runtime-types.ts'
import type { HttpTransport } from './transport.ts'

/**
 * Hai cách xác thực tới Proxmox.
 *
 * `ticket` — đăng nhập username/password, có thể kèm TOTP. Ticket sống 2 giờ.
 * `token`  — header `Authorization: PVEAPIToken=…`. Không cần CSRF, không hết hạn,
 *            thu hồi được riêng lẻ, nhưng bị chặn ở 5 endpoint có `allowToken: false`.
 */
export type AuthKind = 'ticket' | 'token'

export interface AuthProvider {
  readonly kind: AuthKind
  /** Header cần gắn cho request. Phương thức ghi cần thêm CSRF token. */
  headers(method: PveHttpMethod): Promise<Record<string, string>>
  /** Endpoint này có gọi được bằng cách xác thực hiện tại không. */
  supportsEndpoint(endpoint: EndpointRuntime): boolean
  /**
   * Cookie phiên, dành cho relay console.
   *
   * WebSocket của console cần `PVEAuthCookie`; API Token không dùng được ở đó cho dù
   * `allowToken` là true, vì bắt tay WebSocket không mang header Authorization.
   */
  sessionCookie(): string | null
  /** Bỏ trạng thái đã xác thực, buộc lần gọi sau phải đăng nhập lại. */
  invalidate(): void
}

// ─────────────────────────────────────────────────────────────────────────────
// API Token
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenCredentials {
  /** Dạng `user@realm`, ví dụ `root@pam`. */
  username: string
  /** Chỉ phần tên token, không kèm user@realm. */
  tokenId: string
  tokenSecret: string
}

export class TokenAuthProvider implements AuthProvider {
  readonly kind = 'token' as const
  private readonly header: string

  constructor(credentials: TokenCredentials) {
    const { username, tokenId, tokenSecret } = credentials
    this.header = `PVEAPIToken=${username}!${tokenId}=${tokenSecret}`
  }

  async headers(): Promise<Record<string, string>> {
    // Token không cần CSRF token, kể cả với POST/PUT/DELETE.
    return { Authorization: this.header }
  }

  supportsEndpoint(endpoint: EndpointRuntime): boolean {
    return endpoint.allowToken
  }

  sessionCookie(): null {
    return null
  }

  invalidate(): void {
    // Token không có trạng thái để bỏ.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticket
// ─────────────────────────────────────────────────────────────────────────────

export interface TicketCredentials {
  /** Dạng `user@realm`, ví dụ `root@pam`. */
  username: string
  password: string
}

export interface TicketSession {
  ticket: string
  csrfToken: string
  username: string
  clusterName?: string
  /** Thời điểm ticket hết hạn, tính từ lúc lấy được. */
  expiresAt: number
}

export type TicketLoginResult =
  | { status: 'ok'; session: TicketSession }
  | {
      status: 'tfa-required'
      /** Truyền lại nguyên văn vào `completeTfa`. */
      challenge: string
      partialTicket: string
    }
  | { status: 'failed'; message: string }

/** Ticket sống 2 giờ; gia hạn sớm để không bao giờ chạm mép. */
const TICKET_LIFETIME_MS = 2 * 60 * 60 * 1000
const RENEW_BEFORE_MS = 65 * 60 * 1000

interface TicketResponseData {
  ticket?: unknown
  CSRFPreventionToken?: unknown
  username?: unknown
  clustername?: unknown
  NeedTFA?: unknown
}

export class TicketAuthProvider implements AuthProvider {
  readonly kind = 'ticket' as const
  private session: TicketSession | null = null
  private pending: Promise<void> | null = null

  private readonly transport: HttpTransport
  private readonly credentials: TicketCredentials

  constructor(transport: HttpTransport, credentials: TicketCredentials) {
    this.transport = transport
    this.credentials = credentials
  }

  async headers(method: PveHttpMethod): Promise<Record<string, string>> {
    const session = await this.ensureSession()

    const headers: Record<string, string> = {
      // Ticket chứa dấu hai chấm và dấu bằng. Không mã hoá URL ở đây là nguyên
      // nhân số một gây ra lỗi 401 khó hiểu.
      Cookie: `PVEAuthCookie=${encodeURIComponent(session.ticket)}`,
    }

    if (method !== 'GET') {
      headers['CSRFPreventionToken'] = session.csrfToken
    }

    return headers
  }

  supportsEndpoint(): boolean {
    // Ticket gọi được mọi endpoint.
    return true
  }

  sessionCookie(): string | null {
    return this.session ? `PVEAuthCookie=${encodeURIComponent(this.session.ticket)}` : null
  }

  invalidate(): void {
    this.session = null
  }

  /** Nạp sẵn một phiên đã có, ví dụ sau khi hoàn tất bước TFA. */
  adoptSession(session: TicketSession): void {
    this.session = session
  }

  getSession(): TicketSession | null {
    return this.session
  }

  private async ensureSession(): Promise<TicketSession> {
    const current = this.session
    if (current && Date.now() < current.expiresAt - RENEW_BEFORE_MS) return current

    // Nhiều request song song cùng thấy ticket hết hạn thì chỉ đăng nhập một lần.
    if (!this.pending) {
      this.pending = this.refresh().finally(() => {
        this.pending = null
      })
    }
    await this.pending

    if (!this.session) throw new Error('Xác thực thất bại: không lấy được ticket')
    return this.session
  }

  private async refresh(): Promise<void> {
    const existing = this.session

    // Proxmox cho phép gia hạn bằng cách dùng chính ticket hiện tại làm mật khẩu.
    // Nhờ vậy không cần giữ mật khẩu trong bộ nhớ suốt phiên làm việc.
    const password = existing ? existing.ticket : this.credentials.password

    const result = await login(this.transport, {
      username: this.credentials.username,
      password,
    })

    if (result.status === 'ok') {
      this.session = result.session
      return
    }

    // Gia hạn bằng ticket cũ mà hỏng thì thử lại bằng mật khẩu thật một lần.
    if (existing) {
      this.session = null
      const retry = await login(this.transport, this.credentials)
      if (retry.status === 'ok') {
        this.session = retry.session
        return
      }
    }

    this.session = null
    throw new Error(
      result.status === 'tfa-required'
        ? 'Cần xác thực hai lớp — hãy đăng nhập lại'
        : result.message,
    )
  }
}

/**
 * Gọi `POST /access/ticket`.
 *
 * Tách riêng khỏi provider vì luồng đăng nhập lần đầu (có thể phải qua TFA) do
 * giao diện điều khiển, còn provider chỉ lo giữ và gia hạn phiên.
 */
export async function login(
  transport: HttpTransport,
  credentials: TicketCredentials & { otp?: string; tfaChallenge?: string },
): Promise<TicketLoginResult> {
  const params: Record<string, string> = {
    username: credentials.username,
    password: credentials.password,
  }
  if (credentials.otp) params['otp'] = credentials.otp
  if (credentials.tfaChallenge) params['tfa-challenge'] = credentials.tfaChallenge

  const response = await transport.request({ method: 'POST', pathname: '/access/ticket', params })

  if (response.status === 401) {
    return { status: 'failed', message: 'Sai tên đăng nhập hoặc mật khẩu' }
  }
  if (response.status >= 400) {
    return { status: 'failed', message: `Đăng nhập thất bại: HTTP ${response.status}` }
  }

  const body = response.body
  const data =
    typeof body === 'object' && body !== null && 'data' in body
      ? ((body as { data: unknown }).data as TicketResponseData | null)
      : null

  if (!data || typeof data.ticket !== 'string') {
    return { status: 'failed', message: 'Máy chủ không trả về ticket' }
  }

  // Cần TFA: ticket trả về mới chỉ là vé tạm, phải đổi lấy vé thật bằng mã OTP.
  if (data.NeedTFA === 1 || data.NeedTFA === '1' || data.NeedTFA === true) {
    return {
      status: 'tfa-required',
      challenge: typeof data.NeedTFA === 'string' ? data.NeedTFA : '',
      partialTicket: data.ticket,
    }
  }

  if (typeof data.CSRFPreventionToken !== 'string') {
    return { status: 'failed', message: 'Máy chủ không trả về CSRFPreventionToken' }
  }

  const session: TicketSession = {
    ticket: data.ticket,
    csrfToken: data.CSRFPreventionToken,
    username: typeof data.username === 'string' ? data.username : credentials.username,
    expiresAt: Date.now() + TICKET_LIFETIME_MS,
  }
  if (typeof data.clustername === 'string') session.clusterName = data.clustername

  return { status: 'ok', session }
}
