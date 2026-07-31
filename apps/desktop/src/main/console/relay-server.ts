import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ConsoleKind } from '@pve/ipc'

/**
 * Relay WebSocket chạy trong main process cho console.
 *
 * Vì sao không để renderer nối thẳng `wss://host:8006/...`:
 *
 *  1. `/termproxy` của Proxmox **kiểm tra header `Referer`**, mà renderer thì mang
 *     origin của app chứ không phải của Proxmox. Chromium không cho đặt Referer
 *     trên WebSocket handshake.
 *  2. Cookie jar của Electron ghi đè header `Cookie` ta cố đặt, và với nhiều cluster
 *     thì các jar đụng nhau vì cùng tên cookie `PVEAuthCookie`.
 *  3. Chứng chỉ tự ký buộc phải đi qua `setCertificateVerifyProc`, vốn có cache nên
 *     không được gọi ở mọi request — không dùng làm cổng kiểm soát được.
 *  4. Ticket sẽ lọt vào cookie jar của renderer, đúng thứ kiến trúc này đang tránh.
 *
 * Ở đây main giữ toàn quyền đặt `Cookie`, `Referer`, `Origin` và dùng agent đã ghim
 * vân tay chứng chỉ. Renderer chỉ thấy một URL loopback kèm token dùng một lần.
 *
 * noVNC nhận thẳng đối tượng `WebSocket` đang sống làm tham số thứ hai của
 * `new RFB(target, ws, opts)`, nên nó không bao giờ tự dựng URL — đó là lý do
 * lớn nhất khiến phương án này chạy được.
 */

/** Token sống ngắn: đủ để renderer mở socket, không đủ để bị lợi dụng. */
const TOKEN_TTL_MS = 30_000

export interface RelaySession {
  kind: ConsoleKind
  title: string
  /**
   * Được gọi đúng một lần khi renderer nối vào. Bên triển khai chịu trách nhiệm
   * bơm dữ liệu hai chiều và đóng `client` khi thượng nguồn kết thúc.
   */
  attach(client: WebSocket): void
  /** Dọn dẹp nếu token hết hạn mà renderer không bao giờ nối vào. */
  abandon?(): void
}

interface PendingSession extends RelaySession {
  sessionId: string
  tokenBuffer: Buffer
  expiresAt: number
}

export class ConsoleRelayServer {
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private port = 0
  private readonly pending = new Map<string, PendingSession>()
  private sweepTimer: NodeJS.Timeout | null = null

  async start(): Promise<number> {
    if (this.httpServer) return this.port

    // `noServer` để tự xử lý bước upgrade. Việc này quan trọng: token phải được
    // kiểm TRƯỚC khi bắt tay WebSocket hoàn tất. Nếu để `WebSocketServer` tự nhận
    // rồi mới đóng, ta đã lỡ thiết lập một socket cho kẻ gọi không hợp lệ, và
    // client vẫn kịp thấy sự kiện `open`.
    const wss = new WebSocketServer({
      noServer: true,
      // Console dùng subprotocol nhị phân, giống hệt web UI gốc.
      handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
      maxPayload: 16 * 1024 * 1024,
    })
    this.wss = wss

    const server = createServer((_req, res) => {
      // Cổng này chỉ phục vụ nâng cấp WebSocket. Request HTTP thường không có việc gì ở đây.
      res.writeHead(426, { 'Content-Type': 'text/plain' })
      res.end('Upgrade Required')
    })
    this.httpServer = server

    server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request.url, socket, head, request)
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Chỉ loopback. Không bao giờ đặt 0.0.0.0 ở đây — sẽ phơi console ra mạng LAN.
      // Cổng 0 nghĩa là để hệ điều hành cấp cổng ephemeral, không có cổng cố định để dò.
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (typeof address === 'string' || address === null) {
      throw new Error('Relay console không lấy được cổng đang lắng nghe')
    }
    this.port = address.port

    this.sweepTimer = setInterval(() => this.sweepExpired(), 10_000)
    this.sweepTimer.unref?.()

    return this.port
  }

  private handleUpgrade(
    url: string | undefined,
    socket: Duplex,
    head: Buffer,
    request: IncomingMessage,
  ): void {
    const reject = (status: number, reason: string): void => {
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
      socket.destroy()
    }

    const token = parseToken(url)
    if (token === null) return reject(400, 'Bad Request')

    const session = this.lookupAndConsume(token)
    // Token sai, đã dùng, hoặc đã hết hạn — trả cùng một lỗi để không lộ lý do.
    if (!session) return reject(401, 'Unauthorized')

    this.wss?.handleUpgrade(request, socket, head, (client) => {
      client.binaryType = 'nodebuffer'
      session.attach(client)
    })
  }

  /**
   * Đăng ký một phiên và trả về URL loopback kèm token dùng một lần.
   * Gọi sau khi main đã lấy được ticket từ `/vncproxy` hoặc `/termproxy`.
   */
  createSession(session: RelaySession): { sessionId: string; relayUrl: string } {
    if (!this.wss) throw new Error('Relay console chưa khởi động')

    const sessionId = randomBytes(16).toString('hex')
    const token = randomBytes(32).toString('hex')

    this.pending.set(token, {
      ...session,
      sessionId,
      tokenBuffer: Buffer.from(token, 'utf8'),
      expiresAt: Date.now() + TOKEN_TTL_MS,
    })

    return { sessionId, relayUrl: `ws://127.0.0.1:${this.port}/s/${token}` }
  }

  /**
   * Tra token và **xoá ngay** — token dùng một lần.
   * So sánh theo thời gian hằng số để không rò rỉ thông tin qua thời gian phản hồi.
   */
  private lookupAndConsume(token: string): PendingSession | null {
    const candidate = Buffer.from(token, 'utf8')
    const now = Date.now()

    for (const [key, session] of this.pending) {
      if (
        session.tokenBuffer.length === candidate.length &&
        timingSafeEqual(session.tokenBuffer, candidate)
      ) {
        this.pending.delete(key)
        return session.expiresAt > now ? session : null
      }
    }
    return null
  }

  private sweepExpired(): void {
    const now = Date.now()
    for (const [key, session] of this.pending) {
      if (session.expiresAt <= now) {
        this.pending.delete(key)
        session.abandon?.()
      }
    }
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    for (const session of this.pending.values()) session.abandon?.()
    this.pending.clear()

    // Ngắt các client đang mở trước, nếu không `server.close()` sẽ treo cho tới
    // khi kết nối cuối cùng tự rời đi — làm test chạy chậm và app thoát chậm.
    for (const client of this.wss?.clients ?? []) client.terminate()
    this.wss?.close()
    this.wss = null

    this.httpServer?.close()
    this.httpServer = null
    this.port = 0
  }
}

/** Chỉ chấp nhận đúng dạng `/s/<64 ký tự hex>`. */
function parseToken(url: string | undefined): string | null {
  if (!url) return null
  const match = /^\/s\/([0-9a-f]{64})$/.exec(url.split('?')[0] ?? '')
  return match?.[1] ?? null
}
