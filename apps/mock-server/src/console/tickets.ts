import { randomBytes } from 'node:crypto'

/**
 * Vé console một lần (termproxy / vncproxy / vncshell).
 *
 * Gắn cứng với user + target để tránh race kiểu CVE-2026-51082 / PSA-2026-00014-1:
 * websocket chỉ mở được khi đúng port + ticket + user khớp phiên đã cấp.
 */

export type ConsoleSessionKind = 'term' | 'vnc'

export interface ConsoleTarget {
  node: string
  vmid?: number
  vmtype?: 'qemu' | 'lxc'
  /** Nhãn hiển thị trong fake shell / RFB desktop name. */
  title: string
}

export interface ConsoleTicketEntry {
  ticket: string
  port: number
  kind: ConsoleSessionKind
  user: string
  target: ConsoleTarget
  /** UPID giả lập cho worker proxy (Proxmox thật cũng trả UPID). */
  upid: string
  /** Mật khẩu RFB tuỳ chọn (vncproxy có thể trả). */
  password?: string
  expiresAt: number
  /** Đã bị websocket tiêu thụ chưa — vé dùng một lần. */
  consumed: boolean
}

const TICKET_TTL_MS = 60_000
const PORT_MIN = 5900
const PORT_MAX = 5999

export class ConsoleTicketStore {
  private readonly byPort = new Map<number, ConsoleTicketEntry>()
  private nextPort = PORT_MIN

  reset(): void {
    this.byPort.clear()
    this.nextPort = PORT_MIN
  }

  mint(
    kind: ConsoleSessionKind,
    user: string,
    target: ConsoleTarget,
  ): ConsoleTicketEntry {
    this.sweep()
    const port = this.allocatePort()
    const ticket = randomBytes(24).toString('base64url')
    const upid = `UPID:${target.node}:${hex(process.pid % 0xffff_ffff, 8)}:${hex(Date.now() / 1000, 8)}:${hex(Date.now() / 1000, 8)}:vncproxy:${target.vmid ?? target.node}:${user}:`

    const entry: ConsoleTicketEntry = {
      ticket,
      port,
      kind,
      user,
      target,
      upid,
      password: kind === 'vnc' ? randomBytes(8).toString('hex').slice(0, 8) : undefined,
      expiresAt: Date.now() + TICKET_TTL_MS,
      consumed: false,
    }
    this.byPort.set(port, entry)
    return entry
  }

  /**
   * Tra vé theo port + ticket. Không tiêu thụ — handshake còn cần khớp user.
   */
  peek(port: number, ticket: string): ConsoleTicketEntry | null {
    this.sweep()
    const entry = this.byPort.get(port)
    if (!entry || entry.consumed) return null
    if (entry.ticket !== ticket) return null
    if (Date.now() > entry.expiresAt) {
      this.byPort.delete(port)
      return null
    }
    return entry
  }

  /** Đánh dấu đã dùng sau khi handshake `user:ticket` thành công. */
  consume(port: number): void {
    const entry = this.byPort.get(port)
    if (entry) {
      entry.consumed = true
      this.byPort.delete(port)
    }
  }

  private allocatePort(): number {
    for (let i = 0; i < PORT_MAX - PORT_MIN + 1; i += 1) {
      const port = this.nextPort
      this.nextPort = port >= PORT_MAX ? PORT_MIN : port + 1
      if (!this.byPort.has(port)) return port
    }
    throw new Error('Hết cổng console giả lập (5900–5999)')
  }

  private sweep(): void {
    const now = Date.now()
    for (const [port, entry] of this.byPort) {
      if (entry.expiresAt <= now || entry.consumed) this.byPort.delete(port)
    }
  }
}

function hex(n: number, width: number): string {
  return Math.floor(n).toString(16).padStart(width, '0')
}
