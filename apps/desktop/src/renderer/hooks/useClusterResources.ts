import { useEffect } from 'react'
import { useResources } from '../stores/resources'

/**
 * Theo dõi `/cluster/resources` của một kết nối.
 *
 * Gọi được từ nhiều component cùng lúc (cây tài nguyên, dashboard) mà không tạo
 * thêm poll trùng: mỗi lần gọi mở một `streamId` riêng ở main, nhưng
 * `ResourcePoller` đếm số người theo dõi theo `connectionId` và chỉ thật sự poll
 * một lần — xem `resource-poller.ts`.
 */
export function useClusterResources(connectionId: string | null): {
  resources: unknown[]
  at: number | null
} {
  useEffect(() => {
    if (!connectionId) return

    let cancelled = false
    let streamId: string | null = null

    void window.pve.streamStart('resources', connectionId).then((res) => {
      if (!res.ok) return
      if (cancelled) {
        // Component đã unmount trước khi main kịp trả lời — hủy ngay để không rò rỉ.
        void window.pve.streamStop(res.data.streamId)
        return
      }
      streamId = res.data.streamId
    })

    return () => {
      cancelled = true
      if (streamId) void window.pve.streamStop(streamId)
    }
  }, [connectionId])

  const entry = useResources((s) => (connectionId ? s.byConnection[connectionId] : undefined))
  return { resources: entry?.resources ?? [], at: entry?.at ?? null }
}
