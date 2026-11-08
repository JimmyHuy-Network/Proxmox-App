import { basename } from 'node:path'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { request as httpsRequest } from 'node:https'
import { createTlsAgent } from '../pve/tls-agent.ts'
import {
  IpcChannel,
  type TransferDownloadRequest,
  type TransferEvent,
  type TransferUploadRequest,
} from '@pve/ipc'
import type { ConnectionPool } from '../pve/connection-pool.ts'
import type { TaskTracker } from '../pve/task-tracker.ts'
import { uploadMultipart } from '../pve/multipart-upload.ts'
import { isUpid } from '@pve/api'

type Emit = (event: TransferEvent) => void

/**
 * Upload/download file lớn qua main.
 *
 * Renderer không thấy đường dẫn credential hay byte thô của file — chỉ nhận
 * tiến trình qua `pve:event` kind `transfer`. Huỷ = AbortController.destroy request.
 */
export function registerTransferHandlers(
  pool: ConnectionPool,
  tasks: TaskTracker,
  emit: Emit,
): void {
  const inflight = new Map<string, AbortController>()

  ipcMain.handle(IpcChannel.Transfer, async (event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, message: 'Lệnh không hợp lệ' }
    }
    const cmd = raw as Record<string, unknown>
    const action = cmd['action']

    if (action === 'cancel') {
      const transferId = cmd['transferId']
      if (typeof transferId !== 'string') return { ok: false, message: 'Thiếu transferId' }
      inflight.get(transferId)?.abort()
      inflight.delete(transferId)
      return { ok: true, data: null }
    }

    if (action === 'upload') {
      return startUpload(pool, tasks, emit, inflight, cmd['request'], BrowserWindow.fromWebContents(event.sender))
    }

    if (action === 'download') {
      return startDownload(pool, emit, inflight, cmd['request'], BrowserWindow.fromWebContents(event.sender))
    }

    return { ok: false, message: 'Hành động không hỗ trợ' }
  })
}

async function ensureConnected(pool: ConnectionPool, connectionId: string) {
  let conn = pool.getAuthenticated(connectionId)
  if (!conn) {
    const result = await pool.connect(connectionId)
    if (result.status !== 'ok') {
      throw new Error(result.status === 'failed' ? result.message : 'Kết nối cần được xác nhận trước')
    }
    conn = pool.getAuthenticated(connectionId)
  }
  if (!conn) throw new Error('Không mở được kết nối')
  return conn
}

async function startUpload(
  pool: ConnectionPool,
  tasks: TaskTracker,
  emit: Emit,
  inflight: Map<string, AbortController>,
  rawRequest: unknown,
  parentWindow: BrowserWindow | null,
): Promise<{ ok: true; data: { transferId: string } } | { ok: false; message: string }> {
  if (typeof rawRequest !== 'object' || rawRequest === null) {
    return { ok: false, message: 'Thiếu request' }
  }
  const req = rawRequest as TransferUploadRequest
  if ('filePath' in rawRequest) {
    return { ok: false, message: 'Đường dẫn upload phải được chọn qua hộp thoại của ứng dụng' }
  }
  if (!req.connectionId || !req.node || !req.storage || !req.content) {
    return { ok: false, message: 'Thiếu connectionId/node/storage/content' }
  }

  const picked = await dialog.showOpenDialog(parentWindow ?? undefined!, {
    properties: ['openFile'],
    filters: [
      { name: 'ISO / template', extensions: ['iso', 'img', 'tar', 'gz', 'zst', 'xz', 'ova', 'vma'] },
      { name: 'All', extensions: ['*'] },
    ],
  })
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: false, message: 'Đã huỷ chọn file' }
  }
  const filePath = picked.filePaths[0]

  const filename = req.filename || basename(filePath)
  const transferId = crypto.randomUUID()
  const ac = new AbortController()
  inflight.set(transferId, ac)

  emit({
    kind: 'transfer',
    transferId,
    connectionId: req.connectionId,
    transferKind: 'upload',
    phase: 'started',
    bytesSent: 0,
    totalBytes: 0,
  })

  void (async () => {
    try {
      const conn = await ensureConnected(pool, req.connectionId)
      const endpoint = conn.endpoint()
      const headers = await conn.authHeaders('POST')

      const result = await uploadMultipart({
        host: endpoint.host,
        port: endpoint.port,
        node: req.node,
        storage: req.storage,
        content: req.content,
        filename,
        filePath,
        headers,
        ...(endpoint.certFingerprint ? { pinnedFingerprint: endpoint.certFingerprint } : {}),
        allowSelfSigned: endpoint.allowSelfSigned,
        signal: ac.signal,
        onProgress: (bytesSent, totalBytes) => {
          emit({
            kind: 'transfer',
            transferId,
            connectionId: req.connectionId,
            transferKind: 'upload',
            phase: 'progress',
            bytesSent,
            totalBytes,
          })
        },
      })

      if (ac.signal.aborted) {
        emit({
          kind: 'transfer',
          transferId,
          connectionId: req.connectionId,
          transferKind: 'upload',
          phase: 'cancelled',
        })
        return
      }

      if (result.status >= 400) {
        emit({
          kind: 'transfer',
          transferId,
          connectionId: req.connectionId,
          transferKind: 'upload',
          phase: 'error',
          message: result.message ?? `HTTP ${result.status}`,
        })
        return
      }

      const upid = result.data && isUpid(result.data) ? result.data : undefined
      if (upid) tasks.track(req.connectionId, upid)

      emit({
        kind: 'transfer',
        transferId,
        connectionId: req.connectionId,
        transferKind: 'upload',
        phase: 'done',
        ...(upid ? { upid } : {}),
        ...(result.data && !upid ? { message: result.data } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = ac.signal.aborted || /Abort/i.test(message)
      emit({
        kind: 'transfer',
        transferId,
        connectionId: req.connectionId,
        transferKind: 'upload',
        phase: cancelled ? 'cancelled' : 'error',
        ...(cancelled ? {} : { message }),
      })
    } finally {
      inflight.delete(transferId)
    }
  })()

  return { ok: true, data: { transferId } }
}

async function startDownload(
  pool: ConnectionPool,
  emit: Emit,
  inflight: Map<string, AbortController>,
  rawRequest: unknown,
  parentWindow: BrowserWindow | null,
): Promise<{ ok: true; data: { transferId: string } } | { ok: false; message: string }> {
  if (typeof rawRequest !== 'object' || rawRequest === null) {
    return { ok: false, message: 'Thiếu request' }
  }
  const req = rawRequest as TransferDownloadRequest
  if ('savePath' in rawRequest) {
    return { ok: false, message: 'Đường dẫn lưu phải được chọn qua hộp thoại của ứng dụng' }
  }
  if (!req.connectionId || !req.node || !req.storage || !req.volume) {
    return { ok: false, message: 'Thiếu connectionId/node/storage/volume' }
  }

  let defaultName = basename(req.volume.replace(/\\/g, '/'))
  if (req.filepath) {
    try {
      const decoded = Buffer.from(req.filepath, 'base64').toString('utf8')
      const leaf = decoded.split('/').filter(Boolean).pop()
      if (leaf) defaultName = leaf
    } catch {
      // giữ tên từ volume
    }
  }
  const picked = await dialog.showSaveDialog(parentWindow ?? undefined!, {
    defaultPath: defaultName,
  })
  if (picked.canceled || !picked.filePath) {
    return { ok: false, message: 'Đã huỷ lưu file' }
  }
  const savePath = picked.filePath

  const transferId = crypto.randomUUID()
  const ac = new AbortController()
  inflight.set(transferId, ac)

  emit({
    kind: 'transfer',
    transferId,
    connectionId: req.connectionId,
    transferKind: 'download',
    phase: 'started',
  })

  void (async () => {
    try {
      const conn = await ensureConnected(pool, req.connectionId)
      const endpoint = conn.endpoint()
      const headers = await conn.authHeaders('GET')

      const base =
        `/api2/json/nodes/${encodeURIComponent(req.node)}/storage/${encodeURIComponent(req.storage)}`
      // PBS file-restore khi có filepath; còn lại tải volume content (?download=1).
      const path = req.filepath
        ? `${base}/file-restore/download?volume=${encodeURIComponent(req.volume)}` +
          `&filepath=${encodeURIComponent(req.filepath)}`
        : `${base}/content/${encodeURIComponent(req.volume)}?download=1`

      await new Promise<void>((resolve, reject) => {
        const agent = createTlsAgent({
          ...(endpoint.certFingerprint ? { pinnedFingerprint: endpoint.certFingerprint } : {}),
          allowSelfSigned: endpoint.allowSelfSigned,
        })
        const httpsReq = httpsRequest(
          {
            host: endpoint.host,
            port: endpoint.port,
            method: 'GET',
            path,
            headers: { ...headers, Accept: 'application/octet-stream' },
            agent,
            signal: ac.signal,
            timeout: 30_000,
          },
          (res) => {
            if ((res.statusCode ?? 0) >= 400) {
              res.resume()
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            const total = Number(res.headers['content-length'] ?? 0)
            let sent = 0
            const progress = new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                sent += chunk.length
                emit({
                  kind: 'transfer',
                  transferId,
                  connectionId: req.connectionId,
                  transferKind: 'download',
                  phase: 'progress',
                  bytesSent: sent,
                  ...(total > 0 ? { totalBytes: total } : {}),
                })
                callback(null, chunk)
              },
            })
            const out = createWriteStream(savePath)
            void pipeline(res, progress, out).then(resolve, reject)
          },
        )
        httpsReq.on('error', reject)
        httpsReq.on('timeout', () => httpsReq.destroy(new Error('Download timed out')))
        httpsReq.once('close', () => agent.destroy())
        httpsReq.end()
      })

      if (ac.signal.aborted) {
        emit({
          kind: 'transfer',
          transferId,
          connectionId: req.connectionId,
          transferKind: 'download',
          phase: 'cancelled',
        })
        return
      }

      emit({
        kind: 'transfer',
        transferId,
        connectionId: req.connectionId,
        transferKind: 'download',
        phase: 'done',
        message: savePath,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = ac.signal.aborted || /Abort/i.test(message)
      emit({
        kind: 'transfer',
        transferId,
        connectionId: req.connectionId,
        transferKind: 'download',
        phase: cancelled ? 'cancelled' : 'error',
        ...(cancelled ? {} : { message }),
      })
    } finally {
      inflight.delete(transferId)
    }
  })()

  return { ok: true, data: { transferId } }
}
