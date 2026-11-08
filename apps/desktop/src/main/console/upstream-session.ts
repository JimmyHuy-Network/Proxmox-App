import { createTlsAgent } from '../pve/tls-agent.ts'
import WebSocket, { type RawData } from 'ws'
import type { ConsoleCloseReason, ConsoleKind, ConsoleOpenRequest } from '@pve/ipc'
import type { ConsoleEndpoint } from '../pve/connection.ts'
import type { RelaySession } from './relay-server.ts'

/**
 * Phiên console nối thật tới Proxmox (hoặc mock):
 *
 *   1. POST termproxy / vncproxy / vncshell → { port, ticket, user }
 *   2. Mở wss://host/api2/json/.../vncwebsocket?port&vncticket
 *      với Cookie / Authorization + Referer + Origin (đúng thứ renderer không làm được)
 *   3. Handshake `user:ticket\n` → chờ `OK`
 *   4. Pipe byte hai chiều với socket renderer trên relay loopback
 *
 * PSA-2026-00014-1 / CVE-2026-51082: race vncproxy↔vncwebsocket ở phía server.
 * Client đi đúng luồng web UI gốc nên không bị ảnh hưởng thêm; mock của ta gắn
 * vé với user+target để không tái tạo lỗ hổng.
 */

export interface ProxyTicket {
  port: number
  ticket: string
  user: string
  password?: string
  upid?: string
}

export interface UpstreamSessionHooks {
  onClosed?: (reason: ConsoleCloseReason, message?: string) => void
}

type RequestFn = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  params: Record<string, unknown>,
) => Promise<unknown>

export async function openUpstreamConsole(options: {
  request: RequestFn
  endpoint: ConsoleEndpoint
  open: ConsoleOpenRequest
  hooks?: UpstreamSessionHooks
}): Promise<{ session: RelaySession; title: string; proxy: ProxyTicket }> {
  const { request, endpoint, open, hooks } = options
  const { path, title } = resolveProxyPath(open)
  const raw = (await request('POST', path, buildProxyParams(open))) as Record<string, unknown>

  const port = Number(raw['port'])
  const ticket = String(raw['ticket'] ?? '')
  const user = String(raw['user'] ?? endpoint.username)
  if (!Number.isFinite(port) || !ticket) {
    throw new Error('Máy chủ không trả về port/ticket console')
  }

  const proxy: ProxyTicket = {
    port,
    ticket,
    user,
    ...(typeof raw['password'] === 'string' ? { password: raw['password'] } : {}),
    ...(typeof raw['upid'] === 'string' ? { upid: raw['upid'] } : {}),
  }

  const session = createUpstreamRelaySession({
    kind: open.kind === 'spice' ? 'vnc' : open.kind,
    title,
    endpoint,
    open,
    proxy,
    hooks,
  })

  return { session, title, proxy }
}

function resolveProxyPath(open: ConsoleOpenRequest): { path: string; title: string } {
  const { node, vmid, vmtype, kind } = open

  if (vmid !== undefined && vmtype) {
    const label = vmtype === 'qemu' ? 'VM' : 'CT'
    if (kind === 'term') {
      return {
        path: `/nodes/{node}/${vmtype}/{vmid}/termproxy`,
        title: `${node} — ${label} ${vmid} (terminal)`,
      }
    }
    if (kind === 'spice') {
      return {
        path: `/nodes/{node}/${vmtype}/{vmid}/spiceproxy`,
        title: `${node} — ${label} ${vmid} (SPICE)`,
      }
    }
    return {
      path: `/nodes/{node}/${vmtype}/{vmid}/vncproxy`,
      title: `${node} — ${label} ${vmid} (VNC)`,
    }
  }

  // Node shell
  if (kind === 'term') {
    return { path: '/nodes/{node}/termproxy', title: `${node} — shell` }
  }
  if (kind === 'spice') {
    return { path: '/nodes/{node}/spiceshell', title: `${node} — SPICE shell` }
  }
  return { path: '/nodes/{node}/vncshell', title: `${node} — VNC shell` }
}

function buildProxyParams(open: ConsoleOpenRequest): Record<string, unknown> {
  const params: Record<string, unknown> = { node: open.node }
  if (open.vmid !== undefined) params['vmid'] = open.vmid
  return params
}

function createUpstreamRelaySession(init: {
  kind: ConsoleKind
  title: string
  endpoint: ConsoleEndpoint
  open: ConsoleOpenRequest
  proxy: ProxyTicket
  hooks?: UpstreamSessionHooks
}): RelaySession {
  let upstream: WebSocket | null = null
  let abandoned = false

  return {
    kind: init.kind,
    title: init.title,
    abandon() {
      abandoned = true
      upstream?.close()
    },
    attach(client) {
      if (abandoned) {
        client.close(4100, 'abandoned')
        return
      }

      const wsPath = buildVncWebsocketPath(init.open, init.proxy)
      const headers = buildUpstreamHeaders(init.endpoint)
      const agent = createTlsAgent(init.endpoint)
      const ws = new WebSocket(`wss://${init.endpoint.host}:${init.endpoint.port}${wsPath}`, 'binary', {
        headers,
        agent,
        handshakeTimeout: 10_000,
      })
      upstream = ws
      ws.binaryType = 'nodebuffer'

      let handshakeDone = false
      let handshakeBuf = Buffer.alloc(0)
      let closed = false
      // Renderer thường gửi resize ngay khi socket open, trước khi upstream trả OK.
      // Drop những frame này → PTY LXC/node không nhận kích thước → console đen rỗng.
      const pendingFromClient: Array<{ data: RawData; isBinary: boolean }> = []

      const finish = (reason: ConsoleCloseReason, message?: string): void => {
        if (closed) return
        closed = true
        pendingFromClient.length = 0
        agent.destroy()
        init.hooks?.onClosed?.(reason, message)
        if (client.readyState === client.OPEN) client.close()
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
      }

      const forwardToUpstream = (data: RawData, isBinary: boolean): void => {
        if (ws.readyState !== ws.OPEN) return
        // Giữ nguyên loại frame: termproxy nhận protocol string qua text frame
        // (giống web UI); binary thì chuyển nguyên Buffer.
        if (isBinary) {
          ws.send(data)
          return
        }
        ws.send(typeof data === 'string' ? data : toBuffer(data).toString('utf8'))
      }

      const completeHandshake = (rest: Buffer): void => {
        handshakeDone = true
        handshakeBuf = Buffer.alloc(0)
        for (const frame of pendingFromClient) {
          forwardToUpstream(frame.data, frame.isBinary)
        }
        pendingFromClient.length = 0
        if (rest.length > 0 && client.readyState === client.OPEN) {
          client.send(rest)
        }
      }

      ws.on('open', () => {
        // Handshake termproxy/vnc: `user:ticket\n` — xử lý trong main để ticket
        // không bao giờ lọt sang renderer.
        ws.send(Buffer.from(`${init.proxy.user}:${init.proxy.ticket}\n`, 'utf8'))
      })

      ws.on('message', (data: RawData, isBinary: boolean) => {
        const chunk = toBuffer(data)
        void isBinary
        if (!handshakeDone) {
          handshakeBuf = Buffer.concat([handshakeBuf, chunk])
          const okAt = handshakeBuf.indexOf(OK_MARKER)
          if (okAt < 0) {
            if (handshakeBuf.length > 64) {
              finish('auth-failed', 'Handshake console thất bại')
            }
            return
          }
          // Phần sau "OK" (+ optional CR/LF) chuyển tiếp raw — không decode UTF-8
          // lại để tránh làm vỡ byte terminal nếu dính cùng gói.
          let restStart = okAt + OK_MARKER.length
          if (handshakeBuf[restStart] === 0x0d) restStart += 1
          if (handshakeBuf[restStart] === 0x0a) restStart += 1
          completeHandshake(handshakeBuf.subarray(restStart))
          return
        }

        if (client.readyState === client.OPEN) client.send(chunk)
      })

      ws.on('close', () => finish('upstream-closed'))
      ws.on('error', (err) => finish('upstream-error', err.message))

      client.on('message', (data: RawData, isBinary: boolean) => {
        if (!handshakeDone) {
          pendingFromClient.push({ data, isBinary })
          return
        }
        forwardToUpstream(data, isBinary)
      })
      client.on('close', () => finish('client'))
      client.on('error', () => finish('client'))
    },
  }
}

const OK_MARKER = Buffer.from('OK', 'utf8')

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  return Buffer.from(String(data), 'utf8')
}

function buildVncWebsocketPath(open: ConsoleOpenRequest, proxy: ProxyTicket): string {
  const q = new URLSearchParams({
    port: String(proxy.port),
    vncticket: proxy.ticket,
  })
  if (open.vmid !== undefined && open.vmtype) {
    return `/api2/json/nodes/${encodeURIComponent(open.node)}/${open.vmtype}/${open.vmid}/vncwebsocket?${q}`
  }
  return `/api2/json/nodes/${encodeURIComponent(open.node)}/vncwebsocket?${q}`
}

function buildUpstreamHeaders(endpoint: ConsoleEndpoint): Record<string, string> {
  const origin = `https://${endpoint.host}:${endpoint.port}`
  const headers: Record<string, string> = {
    // Proxmox termproxy/vncwebsocket kiểm tra Referer.
    Origin: origin,
    Referer: `${origin}/`,
  }
  if (endpoint.cookie) headers['Cookie'] = endpoint.cookie
  if (endpoint.authorization) headers['Authorization'] = endpoint.authorization
  return headers
}

export async function fetchSpiceConfig(
  request: RequestFn,
  open: ConsoleOpenRequest,
): Promise<Record<string, unknown>> {
  const { path } = resolveProxyPath({ ...open, kind: 'spice' })
  const raw = (await request('POST', path, buildProxyParams(open))) as Record<string, unknown>
  if (typeof raw['host'] !== 'string' || typeof raw['password'] !== 'string') {
    throw new Error('Máy chủ không trả về cấu hình SPICE')
  }
  return raw
}

export function formatVirtViewerFile(spice: Record<string, unknown>): string {
  const lines = [
    '[virt-viewer]',
    `type=${String(spice['type'] ?? 'spice')}`,
    `host=${String(spice['host'])}`,
    `password=${String(spice['password'])}`,
    `proxy=${String(spice['proxy'] ?? '')}`,
    `tls-port=${String(spice['tls-port'] ?? '')}`,
    'delete-this-file=1',
    '',
  ]
  return lines.join('\n')
}
