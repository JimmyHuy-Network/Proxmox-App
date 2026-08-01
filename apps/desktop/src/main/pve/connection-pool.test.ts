import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startMockServer } from '@pve/mock-server'
import type { Encryptor } from '../security/encryptor.ts'
import { Vault } from '../security/vault.ts'
import { ConnectionPool } from './connection-pool.ts'
import { probeCertificate } from './https-transport.ts'

/**
 * Integration test cho connection pool, chạy với mock Proxmox thật trên HTTPS
 * tự ký. Kiểm cả bốn nhánh xác thực: token, ticket, TFA, và trust-on-first-use
 * chứng chỉ — những thứ chỉ lộ đúng/sai khi có một máy chủ TLS thật.
 */

class FakeEncryptor implements Encryptor {
  isAvailable(): boolean {
    return true
  }
  encrypt(plain: string): Buffer {
    return Buffer.from(plain, 'utf8')
  }
  decrypt(blob: Buffer): string {
    return blob.toString('utf8')
  }
}

let server: Awaited<ReturnType<typeof startMockServer>>
let host: string
let port: number
let fingerprint: string
let dir: string
let vault: Vault
let events: { id: string; phase: string }[]

beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)
  const url = new URL(server.url)
  host = url.hostname
  port = Number(url.port)
  fingerprint = (await probeCertificate(host, port)).fingerprint256
}, 30_000)

afterAll(async () => {
  await server?.close()
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pve-pool-'))
  vault = new Vault(join(dir, 'vault.json'), new FakeEncryptor())
  events = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function newPool(): ConnectionPool {
  return new ConnectionPool(vault, (id, phase) => events.push({ id, phase }))
}

describe('xác thực bằng ticket', () => {
  it('mở kết nối và gọi được API', async () => {
    const { id } = vault.upsert({
      name: 'Lab',
      host,
      port,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'matkhaubatky',
      allowSelfSigned: true, // bỏ qua bước cert để tập trung vào ticket
    })

    const pool = newPool()
    const result = await pool.connect(id)
    expect(result.status).toBe('ok')

    const version = (await pool.request(id, 'GET', '/version', {})) as { version: string }
    expect(version.version).toBe('9.2.1')

    // Đã đi qua các trạng thái mong đợi.
    expect(events.map((e) => e.phase)).toContain('authenticated')

    // Ticket auth phải có cookie phiên cho console.
    expect(pool.sessionCookie(id)).not.toBeNull()
    pool.closeAll()
  })

  it('báo lỗi khi mật khẩu sai', async () => {
    const { id } = vault.upsert({
      name: 'Lab',
      host,
      port,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'sai',
      allowSelfSigned: true,
    })

    const pool = newPool()
    const result = await pool.connect(id)
    expect(result.status).toBe('failed')
    expect(events.map((e) => e.phase)).toContain('failed')
  })
})

describe('xác thực hai lớp (TFA)', () => {
  it('yêu cầu OTP rồi hoàn tất', async () => {
    const { id } = vault.upsert({
      name: 'Có 2FA',
      host,
      port,
      authMode: 'ticket',
      username: 'tfa@pve',
      password: 'matkhau',
      allowSelfSigned: true,
    })

    const pool = newPool()
    const first = await pool.connect(id)
    expect(first.status).toBe('tfa-challenge')
    expect(events.map((e) => e.phase)).toContain('tfa-challenge')

    const done = await pool.completeTfa(id, '123456')
    expect(done.status).toBe('ok')

    const version = (await pool.request(id, 'GET', '/version', {})) as { version: string }
    expect(version.version).toBe('9.2.1')
    pool.closeAll()
  })

  it('từ chối mã OTP sai', async () => {
    const { id } = vault.upsert({
      name: 'Có 2FA',
      host,
      port,
      authMode: 'ticket',
      username: 'tfa@pve',
      password: 'matkhau',
      allowSelfSigned: true,
    })

    const pool = newPool()
    await pool.connect(id)
    const done = await pool.completeTfa(id, '000000')
    expect(done.status).toBe('failed')
    pool.closeAll()
  })
})

describe('xác thực bằng API Token', () => {
  it('mở kết nối và gọi được API', async () => {
    const { id } = vault.upsert({
      name: 'Token',
      host,
      port,
      authMode: 'token',
      username: 'root@pam',
      tokenId: 'automation',
      tokenSecret: '00000000-1111-2222-3333-444444444444',
      allowSelfSigned: true,
    })

    const pool = newPool()
    const result = await pool.connect(id)
    expect(result.status).toBe('ok')

    const nodes = (await pool.request(id, 'GET', '/nodes', {})) as unknown[]
    expect(nodes.length).toBe(3)

    // Token không tạo cookie phiên — console qua token dùng Authorization header.
    expect(pool.sessionCookie(id)).toBeNull()
    pool.closeAll()
  })

  it('token bị chặn ở endpoint allowToken=false ngay tại client', async () => {
    const { id } = vault.upsert({
      name: 'Token',
      host,
      port,
      authMode: 'token',
      username: 'root@pam',
      tokenId: 'automation',
      tokenSecret: '00000000-1111-2222-3333-444444444444',
      allowSelfSigned: true,
    })

    const pool = newPool()
    await pool.connect(id)
    await expect(
      pool.request(id, 'PUT', '/access/password', { userid: 'root@pam', password: 'x' }),
    ).rejects.toMatchObject({ kind: 'token-not-permitted' })
    pool.closeAll()
  })
})

describe('trust-on-first-use chứng chỉ', () => {
  it('yêu cầu xác nhận cert rồi kết nối sau khi ghim', async () => {
    const { id } = vault.upsert({
      name: 'Chưa tin cert',
      host,
      port,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'matkhau',
      allowSelfSigned: false, // buộc đi qua bước xác nhận chứng chỉ
    })

    const pool = newPool()
    const first = await pool.connect(id)
    expect(first.status).toBe('cert-untrusted')
    if (first.status !== 'cert-untrusted') throw new Error('unreachable')
    expect(first.cert.fingerprint256).toBe(fingerprint)
    expect(events.map((e) => e.phase)).toContain('cert-challenge')

    // Người dùng đối chiếu vân tay rồi tin tưởng.
    const after = await pool.trustCertAndConnect(id, first.cert.fingerprint256)
    expect(after.status).toBe('ok')

    // Kết nối giờ dùng transport đã ghim vân tay.
    const version = (await pool.request(id, 'GET', '/version', {})) as { version: string }
    expect(version.version).toBe('9.2.1')

    // Vân tay đã được lưu bền vững.
    expect(vault.getMeta(id)?.certFingerprint).toBe(fingerprint)
    pool.closeAll()
  })
})

describe('testConnection (chưa lưu)', () => {
  it('trả về cert-untrusted khi chưa tin cert', async () => {
    const result = await newPool().testConnection({
      name: 'Thử',
      host,
      port,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'matkhau',
      allowSelfSigned: false,
    })
    expect(result.status).toBe('cert-untrusted')
  })

  it('xác minh credential khi đã bỏ qua cert', async () => {
    const result = await newPool().testConnection({
      name: 'Thử',
      host,
      port,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'matkhaubatky',
      allowSelfSigned: true,
    })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.version).toBe('9.2.1')
  })

  it('báo lỗi khi không kết nối được', async () => {
    const result = await newPool().testConnection({
      name: 'Thử',
      host: '127.0.0.1',
      port: 1,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'x',
      allowSelfSigned: false,
    })
    expect(result.status).toBe('error')
  })
})
