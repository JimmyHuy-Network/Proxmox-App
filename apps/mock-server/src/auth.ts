import { randomBytes } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

/**
 * Xác thực giả lập.
 *
 * Chấp nhận mọi mật khẩu **trừ** chuỗi `sai` — nhờ vậy kiểm được đường xử lý đăng
 * nhập thất bại mà không cần dựng kho người dùng thật. Tài khoản `tfa@pve` luôn
 * yêu cầu bước xác thực hai lớp, dùng để dựng giao diện nhập mã OTP.
 */

const TICKET_LIFETIME_MS = 2 * 60 * 60 * 1000
const WRONG_PASSWORD = 'sai'
const TFA_USER = 'tfa@pve'
const TFA_CODE = '123456'

export interface MockTicket {
  ticket: string
  csrfToken: string
  username: string
  expiresAt: number
}

export interface MockToken {
  username: string
  tokenId: string
  secret: string
}

export class AuthStore {
  private readonly tickets = new Map<string, MockTicket>()
  private readonly tfaChallenges = new Map<string, string>()

  readonly tokens: MockToken[] = [
    { username: 'root@pam', tokenId: 'automation', secret: '00000000-1111-2222-3333-444444444444' },
  ]

  reset(): void {
    this.tickets.clear()
    this.tfaChallenges.clear()
  }

  login(
    username: string,
    password: string,
    tfaChallenge?: string,
  ):
    | { status: 'ok'; ticket: MockTicket }
    | { status: 'tfa'; partialTicket: string }
    | { status: 'failed' } {
    // Bước hai của TFA: mật khẩu lúc này là mã OTP dạng `totp:123456`.
    if (tfaChallenge) {
      const pending = this.tfaChallenges.get(tfaChallenge)
      if (!pending) return { status: 'failed' }
      const code = password.replace(/^totp:/, '')
      if (code !== TFA_CODE) return { status: 'failed' }
      this.tfaChallenges.delete(tfaChallenge)
      return { status: 'ok', ticket: this.issue(pending) }
    }

    if (password === WRONG_PASSWORD) return { status: 'failed' }

    // Gia hạn: Proxmox cho dùng chính ticket hiện tại làm mật khẩu.
    const existing = this.tickets.get(password)
    if (existing && existing.username === username) {
      return { status: 'ok', ticket: this.issue(username) }
    }

    if (username === TFA_USER) {
      const challenge = randomBytes(16).toString('hex')
      this.tfaChallenges.set(challenge, username)
      return { status: 'tfa', partialTicket: challenge }
    }

    return { status: 'ok', ticket: this.issue(username) }
  }

  private issue(username: string): MockTicket {
    // Ticket thật của Proxmox chứa dấu hai chấm và dấu bằng — giữ đúng như vậy để
    // bắt được lỗi quên mã hoá URL khi đặt vào cookie.
    const ticket = `PVE:${username}:${randomBytes(6).toString('hex').toUpperCase()}::${randomBytes(24).toString('base64')}`
    const entry: MockTicket = {
      ticket,
      csrfToken: `${Math.floor(Date.now() / 1000).toString(16)}:${randomBytes(12).toString('base64')}`,
      username,
      expiresAt: Date.now() + TICKET_LIFETIME_MS,
    }
    this.tickets.set(ticket, entry)
    return entry
  }

  verifyTicket(ticket: string): MockTicket | null {
    const entry = this.tickets.get(ticket)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.tickets.delete(ticket)
      return null
    }
    return entry
  }

  verifyToken(header: string): MockToken | null {
    // Dạng: PVEAPIToken=USER@REALM!TOKENID=UUID
    const match = /^PVEAPIToken=([^!]+)!([^=]+)=(.+)$/.exec(header.trim())
    if (!match) return null
    const [, username, tokenId, secret] = match
    return (
      this.tokens.find(
        (t) => t.username === username && t.tokenId === tokenId && t.secret === secret,
      ) ?? null
    )
  }
}

export interface AuthContext {
  kind: 'ticket' | 'token'
  username: string
  csrfToken?: string
}

/** Đủ cho cả FastifyRequest và IncomingMessage của bước WebSocket upgrade. */
export function authenticate(
  store: AuthStore,
  request: { headers: IncomingHttpHeaders },
): AuthContext | null {
  const authorization = request.headers['authorization']
  if (typeof authorization === 'string' && authorization.startsWith('PVEAPIToken=')) {
    const token = store.verifyToken(authorization)
    return token ? { kind: 'token', username: token.username } : null
  }

  const cookie = request.headers['cookie']
  if (typeof cookie === 'string') {
    const match = /PVEAuthCookie=([^;]+)/.exec(cookie)
    if (match?.[1]) {
      // Client bắt buộc phải mã hoá URL ticket khi đặt vào cookie; giải mã lại ở đây.
      const ticket = decodeURIComponent(match[1])
      const entry = store.verifyTicket(ticket)
      if (entry) {
        return { kind: 'ticket', username: entry.username, csrfToken: entry.csrfToken }
      }
    }
  }

  return null
}

export { TFA_CODE, TFA_USER, WRONG_PASSWORD }
