import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { authenticate, type AuthStore } from '../auth.ts'
import type { ConsoleTicketStore } from './tickets.ts'
import { FakeShell } from './fake-shell.ts'
import { FakeRfb } from './fake-rfb.ts'

/**
 * Nâng cấp WebSocket cho các endpoint `/vncwebsocket` của Proxmox.
 *
 * Fastify đăng ký GET thường (faker) — nhưng khi client gửi Upgrade, ta bắt ở
 * tầng HTTP server trước khi Fastify xử lý, giống cách desktop relay dùng
 * `noServer: true`.
 *
 * Luồng sau khi upgrade:
 *   1. Client gửi `user:ticket\n` (ticket = vncticket từ proxy)
 *   2. Server trả `OK`
 *   3. term → FakeShell (khung termproxy); vnc → FakeRfb (RFB nhị phân)
 */

const VNC_WS_RE =
  /^\/api2\/json\/nodes\/([^/]+)(?:\/(qemu|lxc)\/(\d+))?\/vncwebsocket$/

export function attachConsoleWebSocket(
  server: HttpServer,
  authStore: AuthStore,
  tickets: ConsoleTicketStore,
): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
    maxPayload: 16 * 1024 * 1024,
  })

  server.on('upgrade', (request, socket, head) => {
    void handleUpgrade(request, socket, head, wss, authStore, tickets)
  })

  return wss
}

async function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: WebSocketServer,
  authStore: AuthStore,
  tickets: ConsoleTicketStore,
): Promise<void> {
  const reject = (status: number, reason: string): void => {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  }

  const url = new URL(request.url ?? '', 'https://127.0.0.1')
  const match = VNC_WS_RE.exec(url.pathname)
  if (!match) {
    // Không phải console — để Fastify / listener khác xử lý (hoặc đóng).
    // Fastify không tự upgrade, nên đóng sạch.
    return reject(404, 'Not Found')
  }

  const node = decodeURIComponent(match[1] ?? '')
  const vmtype = match[2] as 'qemu' | 'lxc' | undefined
  const vmid = match[3] ? Number(match[3]) : undefined

  const port = Number(url.searchParams.get('port') ?? '')
  const vncticket = url.searchParams.get('vncticket') ?? ''
  if (!Number.isInteger(port) || port < 5900 || port > 5999 || !vncticket) {
    return reject(400, 'Bad Request')
  }

  // Xác thực giống HTTP: cookie ticket hoặc Authorization token.
  const auth = authenticate(authStore, request)
  if (!auth) return reject(401, 'Unauthorized')

  const entry = tickets.peek(port, vncticket)
  if (!entry) return reject(401, 'Unauthorized')

  // Vé phải khớp target (chống race CVE-2026-51082).
  if (entry.target.node !== node) return reject(401, 'Unauthorized')
  if ((entry.target.vmid ?? undefined) !== vmid) return reject(401, 'Unauthorized')
  if ((entry.target.vmtype ?? undefined) !== vmtype) return reject(401, 'Unauthorized')

  wss.handleUpgrade(request, socket, head, (client) => {
    client.binaryType = 'nodebuffer'
    bindConsoleSession(client, entry, tickets)
  })
}

function bindConsoleSession(
  client: WebSocket,
  entry: ReturnType<ConsoleTicketStore['peek']> & object,
  tickets: ConsoleTicketStore,
): void {
  let handshakeDone = false
  let lineBuf = ''
  let shell: FakeShell | null = null
  let rfb: FakeRfb | null = null

  const sendText = (text: string): void => {
    if (client.readyState === client.OPEN) client.send(Buffer.from(text, 'utf8'))
  }

  const sendBuf = (data: Buffer): void => {
    if (client.readyState === client.OPEN) client.send(data)
  }

  const close = (): void => {
    shell?.close()
    rfb?.close()
    if (client.readyState === client.OPEN) client.close()
  }

  client.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data)

    if (!handshakeDone) {
      lineBuf += buf.toString('utf8')
      const nl = lineBuf.indexOf('\n')
      if (nl < 0) return
      const line = lineBuf.slice(0, nl).replace(/\r$/, '')
      lineBuf = lineBuf.slice(nl + 1)

      const colon = line.indexOf(':')
      if (colon < 0) {
        client.close(4001, 'bad handshake')
        return
      }
      const user = line.slice(0, colon)
      const ticket = line.slice(colon + 1)

      // User trong handshake phải khớp user đã cấp vé (token hoặc ticket user).
      if (user !== entry.user || ticket !== entry.ticket) {
        client.close(4001, 'auth failed')
        return
      }

      tickets.consume(entry.port)
      handshakeDone = true
      sendText('OK')

      if (entry.kind === 'term') {
        shell = new FakeShell(sendText, {
          hostname: entry.target.node,
          title: entry.target.title,
        })
        shell.start()
        // Phần dư sau dòng handshake (hiếm) — bỏ qua.
      } else {
        rfb = new FakeRfb(sendBuf, close, { name: entry.target.title })
        rfb.start()
      }
      return
    }

    if (shell) {
      shell.handleRaw(buf)
      if (shell.isClosed) close()
      return
    }
    if (rfb) {
      rfb.handleRaw(buf)
    }
  })

  client.on('close', () => {
    shell?.close()
    rfb?.close()
  })
  client.on('error', () => {
    shell?.close()
    rfb?.close()
  })
}
