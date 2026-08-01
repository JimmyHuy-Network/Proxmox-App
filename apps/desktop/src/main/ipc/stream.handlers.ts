import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { IpcChannel } from '@pve/ipc'
import type { ResourcePoller } from '../pve/resource-poller.ts'

/**
 * Kênh đăng ký luồng đẩy.
 *
 * Hiện chỉ có một loại luồng: `resources` (theo dõi `/cluster/resources` của một
 * kết nối). Task không cần đăng ký riêng — `pve.handlers` tự động theo dõi mọi
 * UPID trả về, xem `task-tracker.ts`.
 */

type StreamReply = { ok: true; data: { streamId: string } } | { ok: false; message: string }

function parseStart(raw: unknown): { kind: string; connectionId: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r['kind'] !== 'string') return null
  if (typeof r['connectionId'] !== 'string') return null
  return { kind: r['kind'], connectionId: r['connectionId'] }
}

export function registerStreamHandlers(poller: ResourcePoller): void {
  const active = new Map<string, () => void>()

  ipcMain.handle(IpcChannel.PveStreamStart, (_event, raw: unknown): StreamReply => {
    const req = parseStart(raw)
    if (!req) return { ok: false, message: 'Yêu cầu đăng ký luồng không hợp lệ' }

    if (req.kind !== 'resources') {
      return { ok: false, message: `Loại luồng không hỗ trợ: ${req.kind}` }
    }

    const streamId = randomUUID()
    const unsubscribe = poller.subscribe(req.connectionId)
    active.set(streamId, unsubscribe)
    return { ok: true, data: { streamId } }
  })

  ipcMain.handle(IpcChannel.PveStreamStop, (_event, raw: unknown) => {
    const streamId = typeof raw === 'string' ? raw : (raw as { streamId?: string } | null)?.streamId
    if (typeof streamId !== 'string') return { ok: false, message: 'Thiếu streamId' }

    active.get(streamId)?.()
    active.delete(streamId)
    return { ok: true, data: null }
  })
}
