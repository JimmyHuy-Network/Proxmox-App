import type { PveHttpMethod, PveResponse } from '@pve/ipc'

/**
 * Bao mỏng quanh `window.pve.request`, ném lỗi thay vì trả union để hợp với
 * TanStack Query (query coi promise reject là lỗi).
 *
 * Nhắc lại ranh giới: renderer chỉ gửi mẫu đường dẫn + connectionId opaque. Mọi
 * việc điền tham số, xác thực, và giữ credential đều ở main.
 */
export async function pveRequest<T = unknown>(
  connectionId: string,
  method: PveHttpMethod,
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = (await window.pve.request(connectionId, method, path, params)) as PveResponse<T>
  if (!res.ok) {
    const error = new Error(res.error.message) as Error & { payload?: unknown }
    error.payload = res.error
    throw error
  }
  return res.data
}

/** Khóa query dùng chung, để invalidate theo kết nối khi một tác vụ hoàn tất. */
export function pveQueryKey(
  connectionId: string,
  method: PveHttpMethod,
  path: string,
  params?: Record<string, unknown>,
): unknown[] {
  return ['pve', connectionId, method, path, params ?? {}]
}
