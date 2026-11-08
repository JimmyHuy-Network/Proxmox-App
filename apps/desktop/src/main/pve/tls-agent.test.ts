import { createServer, request, type Server } from 'node:https'
import { X509Certificate } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import selfsigned from 'selfsigned'
import { WebSocketServer, type WebSocket } from 'ws'
import { createTlsAgent } from './tls-agent.ts'
import { openUpstreamConsole } from '../console/upstream-session.ts'

let server: Server
let wss: WebSocketServer
let port: number
let fingerprint: string
let requests = 0
let upgrades = 0

beforeAll(async () => {
  const cert = selfsigned.generate([{ name: 'commonName', value: 'tls-test.local' }], {
    keySize: 2048,
    algorithm: 'sha256',
    days: 1,
  })
  fingerprint = new X509Certificate(cert.cert).fingerprint256
  server = createServer({ key: cert.private, cert: cert.cert }, (_req, res) => {
    requests += 1
    res.end('verified download')
  })
  wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    upgrades += 1
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', () => ws.send('OK\nready'))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  for (const client of wss.clients) client.terminate()
  wss.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function download(pin: string): Promise<string> {
  const agent = createTlsAgent({ pinnedFingerprint: pin })
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/download',
        agent,
        headers: { Cookie: 'PVEAuthCookie=FAKE_AUDIT_CREDENTIAL' },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += String(chunk)
        })
        res.on('end', () => resolve(body))
      },
    )
    req.on('error', reject)
    req.once('close', () => agent.destroy())
    req.end()
  })
}

describe('TLS pin before authenticated HTTP or WebSocket requests', () => {
  it('does not send any HTTP request to a server with the wrong certificate', async () => {
    const before = requests
    await expect(download('00'.repeat(32))).rejects.toThrow('FINGERPRINT_MISMATCH')
    expect(requests).toBe(before)
  })

  it('streams a response from the pinned server', async () => {
    await expect(download(fingerprint)).resolves.toBe('verified download')
  })

  it('rejects a console certificate before sending Upgrade credentials or ticket', async () => {
    const before = upgrades
    let resolveClosed!: (message: string | undefined) => void
    const closed = new Promise<string | undefined>((resolve) => {
      resolveClosed = resolve
    })
    const { session } = await openUpstreamConsole({
      request: async () => ({ port: 5900, ticket: 'FAKE_TICKET', user: 'audit@pam' }),
      endpoint: {
        host: '127.0.0.1',
        port,
        username: 'audit@pam',
        cookie: 'PVEAuthCookie=FAKE',
        authorization: null,
        pinnedFingerprint: '00'.repeat(32),
        allowSelfSigned: false,
      },
      open: { connectionId: 'audit', node: 'pve1', kind: 'term' },
      hooks: { onClosed: (_reason, message) => resolveClosed(message) },
    })
    const client = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1, close() {} })
    session.attach(client as unknown as WebSocket)
    expect(await closed).toContain('FINGERPRINT_MISMATCH')
    expect(upgrades).toBe(before)
  })

  it('opens the console and completes its handshake with the pinned server', async () => {
    let resolveReceived!: () => void
    const received = new Promise<void>((resolve) => {
      resolveReceived = resolve
    })
    const { session } = await openUpstreamConsole({
      request: async () => ({ port: 5900, ticket: 'FAKE_TICKET', user: 'audit@pam' }),
      endpoint: {
        host: '127.0.0.1',
        port,
        username: 'audit@pam',
        cookie: 'PVEAuthCookie=FAKE',
        authorization: null,
        pinnedFingerprint: fingerprint,
        allowSelfSigned: false,
      },
      open: { connectionId: 'audit', node: 'pve1', kind: 'term' },
    })
    // The fake renderer is driven only by the local test server.
    const client = Object.assign(new EventEmitter(), {
      readyState: 1,
      OPEN: 1,
      close() {},
      send() {
        resolveReceived()
      },
    })
    const before = upgrades
    session.attach(client as unknown as WebSocket)
    await expect.poll(() => upgrades).toBe(before + 1)
    await received
    client.emit('close')
  })
})
