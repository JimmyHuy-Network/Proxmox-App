import { createServer, type Server } from 'node:https'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import selfsigned from 'selfsigned'
import { createHttpsTransport, probeCertificate } from './https-transport.ts'

/**
 * Test logic ghim vân tay chứng chỉ với một máy chủ HTTPS tự ký tối giản.
 *
 * Tự chứa trong desktop — không cần mock server, chỉ cần một chứng chỉ tự ký thật
 * để kiểm ba nhánh: vân tay khớp thì chấp nhận, vân tay sai thì từ chối, và probe
 * đọc được vân tay cho luồng trust-on-first-use.
 */

let server: Server
let port: number
let fingerprint: string

beforeAll(async () => {
  const pems = selfsigned.generate([{ name: 'commonName', value: 'test.local' }], {
    days: 1,
    keySize: 2048,
    algorithm: 'sha256',
  })

  server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    // Bắt chước hình dạng phản hồi của Proxmox: bọc trong { data: ... }.
    if (req.url?.startsWith('/api2/json/version')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { version: '9.2.2', release: '9.2' } }))
    } else {
      res.writeHead(404)
      res.end(JSON.stringify({ data: null }))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'object' && address) port = address.port

  // Lấy vân tay thật của cert để dùng cho các test ghim.
  const info = await probeCertificate('127.0.0.1', port)
  fingerprint = info.fingerprint256
})

afterAll(() => {
  server.close()
})

describe('probeCertificate', () => {
  it('đọc được vân tay và thông tin chứng chỉ tự ký', async () => {
    const info = await probeCertificate('127.0.0.1', port)
    expect(info.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    expect(info.subject).toContain('test.local')
    expect(info.validFrom).toBeTruthy()
    expect(info.validTo).toBeTruthy()
  })

  it('báo lỗi khi không kết nối được', async () => {
    // Cổng 1 gần như chắc chắn đóng.
    await expect(probeCertificate('127.0.0.1', 1, 2000)).rejects.toThrow()
  })
})

describe('createHttpsTransport với vân tay đã ghim', () => {
  it('chấp nhận khi vân tay khớp', async () => {
    const transport = createHttpsTransport({ host: '127.0.0.1', port, pinnedFingerprint: fingerprint })
    const res = await transport.request({ method: 'GET', pathname: '/version' })
    expect(res.status).toBe(200)
    expect((res.body as { data: { version: string } }).data.version).toBe('9.2.2')
  })

  it('chấp nhận vân tay ghim dù viết thường hay không có dấu hai chấm', async () => {
    const transport = createHttpsTransport({
      host: '127.0.0.1',
      port,
      pinnedFingerprint: fingerprint.replace(/:/g, '').toLowerCase(),
    })
    const res = await transport.request({ method: 'GET', pathname: '/version' })
    expect(res.status).toBe(200)
  })

  it('từ chối khi vân tay không khớp', async () => {
    const wrong = 'AA:'.repeat(31) + 'AA'
    const transport = createHttpsTransport({ host: '127.0.0.1', port, pinnedFingerprint: wrong })
    await expect(transport.request({ method: 'GET', pathname: '/version' })).rejects.toThrow(
      /FINGERPRINT_MISMATCH/,
    )
  })
})

describe('createHttpsTransport không ghim vân tay', () => {
  it('từ chối cert tự ký khi không cho phép (kiểm chuẩn)', async () => {
    const transport = createHttpsTransport({ host: '127.0.0.1', port, allowSelfSigned: false })
    await expect(transport.request({ method: 'GET', pathname: '/version' })).rejects.toThrow()
  })

  it('chấp nhận cert tự ký khi allowSelfSigned (chỉ dùng thoáng qua khi dò)', async () => {
    const transport = createHttpsTransport({ host: '127.0.0.1', port, allowSelfSigned: true })
    const res = await transport.request({ method: 'GET', pathname: '/version' })
    expect(res.status).toBe(200)
  })
})

describe('hủy request', () => {
  it('hủy được qua AbortSignal', async () => {
    const transport = createHttpsTransport({ host: '127.0.0.1', port, pinnedFingerprint: fingerprint })
    const controller = new AbortController()
    controller.abort()
    await expect(
      transport.request({ method: 'GET', pathname: '/version', signal: controller.signal }),
    ).rejects.toThrow(/Aborted/)
  })
})
