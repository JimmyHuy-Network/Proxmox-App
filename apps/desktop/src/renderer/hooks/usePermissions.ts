import { useQuery } from '@tanstack/react-query'
import { pveQueryKey, pveRequest } from '../lib/pve'
import { useConnections } from '../stores/connections'

/** Map path → privilege → 1 từ `GET /access/permissions`. */
export type PermissionsMap = Record<string, Record<string, number>>

/**
 * Quyền hiệu lực của user đang đăng nhập (mỗi user được dump quyền của chính mình).
 * Dùng để làm mờ nút + tooltip thay vì để bấm rồi nhận 403 (tiêu chí GĐ 8).
 */
export function usePermissions(connectionId: string | null): {
  permissions: PermissionsMap
  loading: boolean
  can: (priv: string, path?: string) => boolean
} {
  const username = useConnections((s) => s.connections.find((c) => c.id === connectionId)?.username)

  const q = useQuery({
    queryKey:
      connectionId && username
        ? pveQueryKey(connectionId, 'GET', '/access/permissions', { userid: username })
        : ['permissions', 'idle'],
    queryFn: () =>
      pveRequest<PermissionsMap>(connectionId!, 'GET', '/access/permissions', {
        userid: username,
      }),
    enabled: Boolean(connectionId && username),
    staleTime: 30_000,
  })

  const permissions = q.data ?? {}

  const can = (priv: string, path = '/'): boolean => {
    // Kiểm path cụ thể, rồi leo lên cha, rồi `/`.
    const candidates = [path]
    if (path !== '/') {
      const parts = path.split('/').filter(Boolean)
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        candidates.push('/' + parts.slice(0, i).join('/'))
      }
      if (!candidates.includes('/')) candidates.push('/')
    }
    for (const p of candidates) {
      if (permissions[p]?.[priv]) return true
    }
    // Một số priv chỉ dump ở `/` trong mock
    return Boolean(permissions['/']?.[priv])
  }

  return { permissions, loading: q.isLoading, can }
}
