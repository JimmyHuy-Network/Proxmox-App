import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:https'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import selfsigned from 'selfsigned'
import { IpcChannel, type TransferEvent } from '@pve/ipc'
import type { ConnectionPool } from '../pve/connection-pool.ts'
import type { TaskTracker } from '../pve/task-tracker.ts'

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle },
  dialog: { showOpenDialog: electron.open, showSaveDialog: electron.save },
  BrowserWindow: { fromWebContents: () => null },
}))
import { registerTransferHandlers } from './transfer.handlers.ts'

describe('transfer file permissions', () => {
  let invoke: (event: { sender: object }, command: unknown) => Promise<unknown>
  const pool = { getAuthenticated: vi.fn() }
  const events: TransferEvent[] = []
  let server: Server
  let port: number
  let fingerprint: string
  let dir: string
  let requestCount = 0

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pve-transfer-test-'))
    const cert = selfsigned.generate([{ name: 'commonName', value: 'transfer-test.local' }], {
      keySize: 2048,
      algorithm: 'sha256',
      days: 1,
    })
    fingerprint = new X509Certificate(cert.cert).fingerprint256
    server = createServer({ key: cert.private, cert: cert.cert }, (_req, res) => {
      requestCount += 1
      res.end('verified file')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    registerTransferHandlers(pool as unknown as ConnectionPool, {} as TaskTracker, (event) => {
      events.push(event)
    })
    invoke = electron.handle.mock.calls.find(([channel]) => channel === IpcChannel.Transfer)![1]
  })

  it.each([
    ['upload', { content: 'iso', filePath: 'C:\\private\\credentials' }],
    ['download', { volume: 'local:iso/test.iso', savePath: 'C:\\private\\config' }],
  ])('rejects renderer-provided local paths for %s', async (action, fields) => {
    const response = await invoke(
      { sender: {} },
      {
        action,
        request: {
          connectionId: 'test',
          node: 'pve1',
          storage: 'local',
          ...fields,
        },
      },
    )
    expect(response).toMatchObject({ ok: false })
    expect(electron.open).not.toHaveBeenCalled()
    expect(electron.save).not.toHaveBeenCalled()
    expect(pool.getAuthenticated).not.toHaveBeenCalled()
  })

  it('asks main to select the upload source and respects cancellation', async () => {
    electron.open.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(
      await invoke(
        { sender: {} },
        {
          action: 'upload',
          request: {
            connectionId: 'test',
            node: 'pve1',
            storage: 'local',
            content: 'iso',
          },
        },
      ),
    ).toMatchObject({ ok: false })
    expect(electron.open).toHaveBeenCalledOnce()
    expect(pool.getAuthenticated).not.toHaveBeenCalled()
  })

  it('asks main to select the download destination and respects cancellation', async () => {
    electron.save.mockResolvedValue({ canceled: true })
    expect(
      await invoke(
        { sender: {} },
        {
          action: 'download',
          request: {
            connectionId: 'test',
            node: 'pve1',
            storage: 'local',
            volume: 'local:iso/test.iso',
          },
        },
      ),
    ).toMatchObject({ ok: false })
    expect(electron.save).toHaveBeenCalledOnce()
    expect(pool.getAuthenticated).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'checks the pinned cert in the actual download handler (valid=%s)',
    async (valid) => {
      const path = join(dir, valid ? 'good.iso' : 'blocked.iso')
      electron.save.mockResolvedValue({ canceled: false, filePath: path })
      pool.getAuthenticated.mockReturnValue({
        endpoint: () => ({
          host: '127.0.0.1',
          port,
          allowSelfSigned: true,
          certFingerprint: valid ? fingerprint : '00'.repeat(32),
        }),
        authHeaders: async () => ({ Cookie: 'PVEAuthCookie=FAKE_AUDIT' }),
      })
      const before = requestCount
      expect(
        await invoke(
          { sender: {} },
          {
            action: 'download',
            request: {
              connectionId: 'test',
              node: 'pve1',
              storage: 'local',
              volume: 'local:iso/test.iso',
            },
          },
        ),
      ).toMatchObject({ ok: true })
      await expect.poll(() => events.at(-1)?.phase).toBe(valid ? 'done' : 'error')
      if (valid) {
        expect(await readFile(path, 'utf8')).toBe('verified file')
        expect(requestCount).toBe(before + 1)
      } else {
        expect(events.at(-1)?.message).toContain('FINGERPRINT_MISMATCH')
        expect(requestCount).toBe(before)
        expect(existsSync(path)).toBe(false)
      }
    },
  )
})
