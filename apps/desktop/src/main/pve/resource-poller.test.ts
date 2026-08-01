import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMockServer } from '@pve/mock-server'
import type { Encryptor } from '../security/encryptor.ts'
import { Vault } from '../security/vault.ts'
import { ConnectionPool } from './connection-pool.ts'
import { ResourcePoller } from './resource-poller.ts'

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
let dir: string
let vault: Vault
let pool: ConnectionPool
let connId: string

beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)
  const url = new URL(server.url)
  host = url.hostname
  port = Number(url.port)
}, 30_000)

afterAll(async () => {
  await server?.close()
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pve-poller-'))
  vault = new Vault(join(dir, 'vault.json'), new FakeEncryptor())
  pool = new ConnectionPool(vault)
  const { id } = vault.upsert({
    name: 'Lab',
    host,
    port,
    authMode: 'ticket',
    username: 'root@pam',
    password: 'matkhaubatky',
    allowSelfSigned: true,
  })
  connId = id
  await pool.connect(connId)
})

afterEach(() => {
  pool.closeAll()
  rmSync(dir, { recursive: true, force: true })
})

describe('ResourcePoller', () => {
  it('gọi ngay khi có người theo dõi đầu tiên, không đợi hết nhịp poll', async () => {
    const emitted: unknown[][] = []
    const poller = new ResourcePoller(pool, (_id, resources) => emitted.push(resources))

    const unsubscribe = poller.subscribe(connId)
    await vi.waitFor(() => expect(emitted.length).toBeGreaterThanOrEqual(1), { timeout: 3000 })

    expect(Array.isArray(emitted[0])).toBe(true)
    expect((emitted[0] as unknown[]).length).toBeGreaterThan(0)

    unsubscribe()
    poller.stopAll()
  })

  it('nhiều người theo dõi cùng một kết nối chỉ khiến poll chạy một lần', async () => {
    let tickCount = 0
    // Đếm số lần request thật sự bắn ra bằng cách bọc pool.request.
    const originalRequest = pool.request.bind(pool)
    pool.request = (async (...args: Parameters<typeof pool.request>) => {
      if (args[2] === '/cluster/resources') tickCount += 1
      return originalRequest(...args)
    }) as typeof pool.request

    const poller = new ResourcePoller(pool, () => {})
    const un1 = poller.subscribe(connId)
    const un2 = poller.subscribe(connId)
    const un3 = poller.subscribe(connId)

    await vi.waitFor(() => expect(tickCount).toBeGreaterThanOrEqual(1), { timeout: 3000 })
    const countWithThreeWatchers = tickCount

    // Đợi thêm một khoảng — vẫn phải chỉ có một luồng poll, không nhân ba.
    await new Promise((r) => setTimeout(r, 200))
    expect(tickCount).toBe(countWithThreeWatchers)

    un1()
    un2()
    un3()
    poller.stopAll()
  })

  it('dừng poll khi người theo dõi cuối cùng hủy đăng ký', async () => {
    let tickCount = 0
    const originalRequest = pool.request.bind(pool)
    pool.request = (async (...args: Parameters<typeof pool.request>) => {
      if (args[2] === '/cluster/resources') tickCount += 1
      return originalRequest(...args)
    }) as typeof pool.request

    const poller = new ResourcePoller(pool, () => {})
    const unsubscribe = poller.subscribe(connId)
    await vi.waitFor(() => expect(tickCount).toBeGreaterThanOrEqual(1), { timeout: 3000 })

    unsubscribe()
    const countAfterUnsubscribe = tickCount

    // Không có nhịp poll nào xảy ra sau khi mọi người đã rời — kể cả chờ lâu hơn chu kỳ.
    await new Promise((r) => setTimeout(r, 3500))
    expect(tickCount).toBe(countAfterUnsubscribe)

    poller.stopAll()
  })

  it('gọi hủy đăng ký lặp lại không gây lỗi hay đếm âm', async () => {
    const poller = new ResourcePoller(pool, () => {})
    const unsubscribe = poller.subscribe(connId)
    unsubscribe()
    expect(() => unsubscribe()).not.toThrow()
    poller.stopAll()
  })
})
