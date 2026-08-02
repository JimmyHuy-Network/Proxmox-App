import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PveClient, TicketAuthProvider, createFetchTransport, encodeTermData } from '@pve/api'
import { startMockServer } from '../index.ts'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

let server: Awaited<ReturnType<typeof startMockServer>>
let client: PveClient
let cookie: string

beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)

  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
  client = new PveClient({ transport, auth, connectionId: 'test' })
  // Ép đăng nhập để lấy cookie cho WebSocket.
  await client.request('GET', '/version', {})
  cookie = auth.sessionCookie() ?? ''
  expect(cookie).toBeTruthy()
}, 30_000)

afterAll(async () => {
  await server?.close()
})

function openConsoleWs(path: string, port: number, vncticket: string): WebSocket {
  const q = new URLSearchParams({ port: String(port), vncticket })
  const url = `${server.url.replace('https', 'wss')}/api2/json${path}?${q}`
  return new WebSocket(url, 'binary', {
    headers: { Cookie: cookie },
    rejectUnauthorized: false,
  })
}

interface ProxyTicket {
  port: number
  ticket: string
  user: string
}

describe('mock console termproxy', () => {
  it('POST termproxy rồi mở WS, handshake, nhận MOTD và echo tiếng Việt', async () => {
    const proxy = (await client.request('POST', '/nodes/{node}/termproxy', {
      node: 'pve1',
    })) as ProxyTicket
    expect(proxy.port).toBeGreaterThanOrEqual(5900)
    expect(proxy.user).toBe('root@pam')

    const ws = openConsoleWs('/nodes/pve1/vncwebsocket', proxy.port, proxy.ticket)
    let text = ''
    ws.on('message', (data: Buffer) => {
      text += data.toString('utf8')
    })

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })

    ws.send(Buffer.from(`${proxy.user}:${proxy.ticket}\n`, 'utf8'))

    await waitFor(() => text.includes('Proxmox VE'), 3000)
    expect(text).toContain('OK')

    text = ''
    ws.send(encodeTermData('echo "Xin chào"\r'))
    await waitFor(() => text.includes('Xin chào'), 3000)

    ws.close()
  })

  it('vé dùng một lần — websocket thứ hai bị từ chối', async () => {
    const proxy = (await client.request('POST', '/nodes/{node}/qemu/{vmid}/termproxy', {
      node: 'pve1',
      vmid: 100,
    })) as ProxyTicket
    const ws1 = openConsoleWs('/nodes/pve1/qemu/100/vncwebsocket', proxy.port, proxy.ticket)

    await new Promise<void>((resolve, reject) => {
      ws1.once('open', () => resolve())
      ws1.once('error', reject)
    })
    ws1.send(Buffer.from(`${proxy.user}:${proxy.ticket}\n`, 'utf8'))
    await waitFor(() => true, 50)
    await new Promise((r) => setTimeout(r, 200))
    ws1.close()

    const ws2 = openConsoleWs('/nodes/pve1/qemu/100/vncwebsocket', proxy.port, proxy.ticket)
    const code = await new Promise<number>((resolve) => {
      ws2.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws2.once('open', () => resolve(0))
      ws2.once('error', () => resolve(-1))
    })
    expect(code).toBe(401)
  })
})

describe('mock console vncproxy', () => {
  it('POST vncproxy rồi nhận RFB version sau handshake', async () => {
    const proxy = (await client.request('POST', '/nodes/{node}/qemu/{vmid}/vncproxy', {
      node: 'pve1',
      vmid: 100,
    })) as ProxyTicket
    const ws = openConsoleWs('/nodes/pve1/qemu/100/vncwebsocket', proxy.port, proxy.ticket)

    const chunks: Buffer[] = []
    ws.on('message', (data: Buffer) => chunks.push(Buffer.from(data)))

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    ws.send(Buffer.from(`${proxy.user}:${proxy.ticket}\n`, 'utf8'))

    await waitFor(() => Buffer.concat(chunks).toString('binary').includes('RFB 003.008'), 3000)

    ws.close()
  })
})

describe('mock spiceproxy', () => {
  it('trả về cấu hình virt-viewer', async () => {
    const spice = (await client.request('POST', '/nodes/{node}/qemu/{vmid}/spiceproxy', {
      node: 'pve1',
      vmid: 100,
    })) as { type: string; host: string; password: string }
    expect(spice.type).toBe('spice')
    expect(spice.host).toBe('pve1')
    expect(spice.password).toBeTruthy()
  })
})

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timeout sau ${timeoutMs}ms`)
}
