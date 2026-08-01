import { ipcMain } from 'electron'
import { PveError } from '@pve/api'
import {
  IpcChannel,
  type PveErrorPayload,
  type PveRequestEnvelope,
  type PveResponse,
} from '@pve/ipc'
import type { ConnectionPool } from '../pve/connection-pool.ts'

/**
 * Kênh gọi REST tới Proxmox.
 *
 * Đây là ranh giới tin cậy: renderer gửi một *mẫu* đường dẫn và connectionId dạng
 * opaque, main mới điền tham số và đối chiếu với schema. Renderer không dựng được
 * URL tùy ý và không thấy host hay credential.
 *
 * Ba lớp chặn:
 *  1. connectionId phải tồn tại (kiểm ở đây).
 *  2. path + method phải có trong schema (client.raw đối chiếu PVE_PATHS).
 *  3. params được kiểm theo schema trước khi gửi (client.raw).
 */

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])

function parseEnvelope(raw: unknown): PveRequestEnvelope | null {
  if (typeof raw !== 'object' || raw === null) return null
  const env = raw as Record<string, unknown>

  if (typeof env['connectionId'] !== 'string') return null
  if (typeof env['path'] !== 'string') return null
  if (typeof env['requestId'] !== 'string') return null
  if (typeof env['method'] !== 'string' || !HTTP_METHODS.has(env['method'])) return null
  if (env['params'] !== undefined && (typeof env['params'] !== 'object' || env['params'] === null)) {
    return null
  }

  return {
    connectionId: env['connectionId'],
    method: env['method'] as PveRequestEnvelope['method'],
    path: env['path'],
    requestId: env['requestId'],
    ...(env['params'] ? { params: env['params'] as Record<string, unknown> } : {}),
  }
}

function toErrorPayload(error: unknown, env: PveRequestEnvelope): PveErrorPayload {
  if (error instanceof PveError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      path: env.path,
      method: env.method,
      connectionId: env.connectionId,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    kind: /Aborted/.test(message) ? 'cancelled' : 'network',
    message,
    path: env.path,
    method: env.method,
    connectionId: env.connectionId,
  }
}

export function registerPveHandlers(pool: ConnectionPool): void {
  // requestId → AbortController. AbortSignal không đi qua được IPC nên phải nối
  // thủ công qua kênh pve:cancel.
  const inflight = new Map<string, AbortController>()

  ipcMain.handle(IpcChannel.PveRequest, async (_event, raw: unknown): Promise<PveResponse> => {
    const env = parseEnvelope(raw)
    if (!env) {
      return {
        ok: false,
        error: {
          kind: 'validation',
          message: 'Yêu cầu không hợp lệ',
          path: '',
          method: 'GET',
          connectionId: '',
        },
      }
    }

    const controller = new AbortController()
    inflight.set(env.requestId, controller)

    try {
      const data = await pool.request(
        env.connectionId,
        env.method,
        env.path,
        env.params ?? {},
        controller.signal,
      )
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: toErrorPayload(error, env) }
    } finally {
      inflight.delete(env.requestId)
    }
  })

  ipcMain.handle(IpcChannel.PveCancel, (_event, requestId: unknown) => {
    if (typeof requestId === 'string') {
      inflight.get(requestId)?.abort()
      inflight.delete(requestId)
    }
  })
}
