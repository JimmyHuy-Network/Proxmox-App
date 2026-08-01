import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMockServer } from '@pve/mock-server'
import type { Encryptor } from '../security/encryptor.ts'
import { Vault } from '../security/vault.ts'
import { ConnectionPool } from './connection-pool.ts'
import { TaskTracker, type TaskListener } from './task-tracker.ts'

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
  dir = mkdtempSync(join(tmpdir(), 'pve-tracker-'))
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
  server.mock.reset()
})

afterEach(() => {
  pool.closeAll()
  rmSync(dir, { recursive: true, force: true })
})

function collectEvents(): { events: Parameters<TaskListener>[]; listener: TaskListener } {
  const events: Parameters<TaskListener>[] = []
  return { events, listener: (connectionId, upid, event) => events.push([connectionId, upid, event]) }
}

describe('TaskTracker', () => {
  it('theo dõi một tác vụ thật từ mock tới khi hoàn tất', async () => {
    const { events, listener } = collectEvents()
    const tracker = new TaskTracker(pool, listener)

    // qmstop trên mock chạy ~800ms — đủ nhanh cho test nhưng vẫn có nhịp poll thật.
    const upid = (await pool.request(connId, 'POST', '/nodes/{node}/qemu/{vmid}/status/stop', {
      node: 'pve1',
      vmid: 100,
    })) as string

    tracker.track(connId, upid)

    await vi.waitFor(
      () => {
        const done = events.find((e) => e[2].kind === 'phase' && e[2].phase === 'done')
        expect(done).toBeDefined()
      },
      { timeout: 5000, interval: 100 },
    )

    const phases = events.filter((e) => e[2].kind === 'phase').map((e) => (e[2] as { phase: string }).phase)
    expect(phases).toEqual(['started', 'running', 'done'])

    const doneEvent = events.find((e) => e[2].kind === 'phase' && e[2].phase === 'done')!
    expect((doneEvent[2] as { exitstatus?: string }).exitstatus).toBe('OK')

    tracker.stopAll()
  }, 10_000)

  it('phát log theo con trỏ, không lặp lại dòng cũ', async () => {
    const { events, listener } = collectEvents()
    const tracker = new TaskTracker(pool, listener)

    // vzdump giả lập chạy 15 giây với nhiều dòng log — quá lâu cho test, nên dùng
    // qmshutdown (3 giây, 2 dòng log) để vẫn có ít nhất một lần tail log giữa chừng.
    const upid = (await pool.request(connId, 'POST', '/nodes/{node}/qemu/{vmid}/status/shutdown', {
      node: 'pve1',
      vmid: 100,
    })) as string

    tracker.track(connId, upid)

    await vi.waitFor(
      () => expect(events.some((e) => e[2].kind === 'phase' && e[2].phase === 'done')).toBe(true),
      { timeout: 6000, interval: 100 },
    )

    const logEvents = events.filter((e) => e[2].kind === 'log')
    const allLines = logEvents.flatMap((e) => (e[2] as { lines: { n: number }[] }).lines)
    const seenN = allLines.map((l) => l.n)

    // Không có số thứ tự nào lặp lại — chứng minh con trỏ hoạt động đúng.
    expect(new Set(seenN).size).toBe(seenN.length)
    // Thứ tự tăng dần liên tục.
    expect(seenN).toEqual([...seenN].sort((a, b) => a - b))
    expect(allLines.length).toBeGreaterThan(0)

    tracker.stopAll()
  }, 10_000)

  it('nhiều lần gọi track() cùng một UPID chỉ tạo một poller', async () => {
    const { events, listener } = collectEvents()
    const tracker = new TaskTracker(pool, listener)

    const upid = (await pool.request(connId, 'POST', '/nodes/{node}/qemu/{vmid}/status/stop', {
      node: 'pve1',
      vmid: 100,
    })) as string

    tracker.track(connId, upid)
    tracker.track(connId, upid) // gọi lại — ví dụ hai view cùng quan tâm UPID này
    tracker.track(connId, upid)

    await vi.waitFor(
      () => expect(events.some((e) => e[2].kind === 'phase' && e[2].phase === 'done')).toBe(true),
      { timeout: 5000, interval: 100 },
    )

    // Chỉ đúng MỘT sự kiện 'started' — không nhân ba dù gọi track() ba lần.
    const startedCount = events.filter((e) => e[2].kind === 'phase' && e[2].phase === 'started').length
    expect(startedCount).toBe(1)

    tracker.stopAll()
  }, 10_000)

  it('bỏ qua UPID không hợp lệ, không ném lỗi', () => {
    const { events, listener } = collectEvents()
    const tracker = new TaskTracker(pool, listener)

    tracker.track(connId, 'không-phải-upid')
    tracker.track(connId, 12345)
    tracker.track(connId, undefined)

    expect(events).toEqual([])
    tracker.stopAll()
  })

  it('isTracking phản ánh đúng trạng thái đang theo dõi', async () => {
    const tracker = new TaskTracker(pool, () => {})

    const upid = (await pool.request(connId, 'POST', '/nodes/{node}/qemu/{vmid}/status/stop', {
      node: 'pve1',
      vmid: 100,
    })) as string

    expect(tracker.isTracking(connId, upid)).toBe(false)
    tracker.track(connId, upid)
    expect(tracker.isTracking(connId, upid)).toBe(true)

    await vi.waitFor(() => expect(tracker.isTracking(connId, upid)).toBe(false), {
      timeout: 5000,
      interval: 100,
    })

    tracker.stopAll()
  }, 10_000)
})
