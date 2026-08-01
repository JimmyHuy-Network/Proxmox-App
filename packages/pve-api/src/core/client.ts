import type { PveEndpoints, PveMethodOf, PveParams, PvePath, PveReturns } from '../generated/paths.ts'
import type { AuthProvider } from './auth.ts'
import { PveError, kindFromStatus, parseErrorBody } from './errors.ts'
import { buildPath, encodeParams, findPath, validateParams } from './endpoint.ts'
import type { PveHttpMethod } from './runtime-types.ts'
import type { HttpTransport } from './transport.ts'

export interface PveClientOptions {
  transport: HttpTransport
  auth: AuthProvider
  /** Định danh dùng khi báo lỗi và ghi log. */
  connectionId?: string
  /**
   * Số request chạy song song tối đa.
   *
   * pveproxy là một pool tiến trình Perl; đẩy vài chục request cùng lúc là cách
   * chắc chắn làm nó nghẽn. Sáu là mức web UI gốc hoạt động thoải mái.
   */
  maxConcurrent?: number
  maxRetries?: number
}

const DEFAULT_MAX_CONCURRENT = 6
const DEFAULT_MAX_RETRIES = 3

export class PveClient {
  private readonly transport: HttpTransport
  private readonly auth: AuthProvider
  private readonly connectionId: string | undefined
  private readonly maxConcurrent: number
  private readonly maxRetries: number

  private active = 0
  private readonly queue: (() => void)[] = []

  constructor(options: PveClientOptions) {
    this.transport = options.transport
    this.auth = options.auth
    this.connectionId = options.connectionId
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  }

  /**
   * Gọi một endpoint có kiểu.
   *
   *   const vms = await client.request('GET', '/nodes/{node}/qemu', { node: 'pve1' })
   *   const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/status/start',
   *                                     { node: 'pve1', vmid: 100 })
   */
  async request<P extends PvePath, M extends PveMethodOf<P>>(
    method: M,
    path: P,
    params: PveParams<P, M>,
    signal?: AbortSignal,
  ): Promise<PveReturns<P, M>> {
    return (await this.raw(
      method as PveHttpMethod,
      path,
      params as Record<string, unknown>,
      signal,
    )) as PveReturns<P, M>
  }

  /**
   * Lối thoát không kiểu.
   *
   * Schema của Proxmox tự nhận là "không tương thích 100% với JSONSchema", và API
   * không đánh version. Khi kiểu sinh ra sai hoặc server mới hơn schema đã ghim,
   * đây là đường đi tiếp — kiểu sai không bao giờ được phép chặn người dùng.
   */
  async raw(
    method: PveHttpMethod,
    path: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const pathEntry = findPath(path)
    const endpoint = pathEntry?.methods[method]

    if (!pathEntry || !endpoint) {
      throw new PveError({
        kind: 'unknown-endpoint',
        message: `Không có endpoint ${method} ${path} trong schema PVE đã ghim`,
        path,
        method,
        ...(this.connectionId ? { connectionId: this.connectionId } : {}),
      })
    }

    if (!this.auth.supportsEndpoint(endpoint)) {
      throw new PveError({
        kind: 'token-not-permitted',
        message: `Endpoint này cần đăng nhập bằng mật khẩu, API Token không gọi được (${endpoint.name})`,
        path,
        method,
        ...(this.connectionId ? { connectionId: this.connectionId } : {}),
      })
    }

    const issues = validateParams(endpoint, pathEntry.pathParams, params)
    if (issues.length > 0) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of issues) fieldErrors[issue.param] = issue.message

      throw new PveError({
        kind: 'validation',
        message: issues.map((i) => `${i.param}: ${i.message}`).join('; '),
        fieldErrors,
        path,
        method,
        ...(this.connectionId ? { connectionId: this.connectionId } : {}),
      })
    }

    const { pathname, rest } = buildPath(path, pathEntry.pathParams, params)
    const encoded = encodeParams(rest)

    return this.withSlot(() => this.send(method, path, pathname, encoded, signal))
  }

  private async send(
    method: PveHttpMethod,
    templatePath: string,
    pathname: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // Chỉ thử lại GET. Ghi lên Proxmox không idempotent — một lệnh start bị thử
    // lại sẽ đẻ ra hai task.
    const attempts = method === 'GET' ? this.maxRetries : 1
    let lastError: PveError | null = null

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        const delay = 250 * 4 ** (attempt - 1) + Math.floor(Math.random() * 100)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      try {
        return await this.attempt(method, templatePath, pathname, params, signal, attempt === 0)
      } catch (error) {
        if (!(error instanceof PveError) || !error.isRetryable) throw error
        lastError = error
      }
    }

    throw lastError ?? new Error('Request thất bại không rõ lý do')
  }

  private async attempt(
    method: PveHttpMethod,
    templatePath: string,
    pathname: string,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
    allowReauth: boolean,
  ): Promise<unknown> {
    const fail = (
      kind: PveError['kind'],
      message: string,
      status?: number,
      fieldErrors?: Record<string, string>,
      cause?: unknown,
    ): PveError =>
      new PveError({
        kind,
        message,
        path: templatePath,
        method,
        ...(status !== undefined ? { status } : {}),
        ...(fieldErrors ? { fieldErrors } : {}),
        ...(this.connectionId ? { connectionId: this.connectionId } : {}),
        ...(cause !== undefined ? { cause } : {}),
      })

    let headers: Record<string, string>
    try {
      headers = await this.auth.headers(method)
    } catch (error) {
      throw fail('auth', error instanceof Error ? error.message : 'Xác thực thất bại', undefined, undefined, error)
    }

    let response
    try {
      response = await this.transport.request({
        method,
        pathname,
        params,
        headers,
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'AbortError') throw fail('cancelled', 'Request đã bị huỷ', undefined, undefined, error)
      if (name === 'TimeoutError') throw fail('timeout', 'Hết thời gian chờ máy chủ', undefined, undefined, error)

      const message = error instanceof Error ? error.message : String(error)
      const kind = /certificate|self.signed|TLS|SSL/i.test(message) ? 'tls' : 'network'
      throw fail(kind, message, undefined, undefined, error)
    }

    if (response.status === 401 && allowReauth) {
      // Ticket có thể đã hết hạn sớm hơn dự kiến (server khởi động lại, quản trị
      // viên thu hồi). Bỏ phiên rồi thử đúng một lần nữa.
      this.auth.invalidate()
      return this.attempt(method, templatePath, pathname, params, signal, false)
    }

    if (response.status >= 400) {
      const { message, fieldErrors } = parseErrorBody(response.body)
      throw fail(
        kindFromStatus(response.status),
        message ?? `HTTP ${response.status} ${response.statusText}`,
        response.status,
        fieldErrors,
      )
    }

    // Mọi phản hồi thành công của Proxmox đều bọc trong { data: ... }.
    if (typeof response.body === 'object' && response.body !== null && 'data' in response.body) {
      return (response.body as { data: unknown }).data
    }
    return response.body
  }

  /** Giới hạn số request song song, phần dư xếp hàng chờ. */
  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.queue.shift()?.()
    }
  }
}

export type { PveEndpoints, PveMethodOf, PveParams, PvePath, PveReturns }
