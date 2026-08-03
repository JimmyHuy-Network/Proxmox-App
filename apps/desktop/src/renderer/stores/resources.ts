import { create } from 'zustand'

/**
 * Kết quả `/cluster/resources` mới nhất theo từng kết nối, đẩy từ poller trong main.
 *
 * Không dùng TanStack Query cho dữ liệu này: main đã tự poll và đẩy sự kiện, nên
 * renderer chỉ cần lưu lại — poll thêm lần nữa ở đây sẽ tạo ra hai nguồn dữ liệu
 * lệch pha nhau.
 */
interface ClusterResourcesEntry {
  resources: unknown[]
  at: number
  /** Chữ ký nhẹ để bỏ qua set khi poll không đổi (GĐ 9 perf). */
  signature: string
}

interface ResourcesState {
  byConnection: Record<string, ClusterResourcesEntry>
  setResources: (connectionId: string, resources: unknown[], at: number) => void
}

/** Chữ ký ổn định đủ để so sánh nhịp poll — tránh re-render Tree khi dữ liệu giống. */
export function resourcesSignature(resources: unknown[]): string {
  const parts: string[] = [String(resources.length)]
  for (const raw of resources) {
    if (!raw || typeof raw !== 'object') {
      parts.push('?')
      continue
    }
    const r = raw as Record<string, unknown>
    parts.push(
      [
        r['id'] ?? '',
        r['type'] ?? '',
        r['status'] ?? '',
        r['node'] ?? '',
        r['vmid'] ?? '',
        r['name'] ?? '',
        r['uptime'] ?? '',
        r['cpu'] ?? '',
        r['mem'] ?? '',
        r['maxmem'] ?? '',
        r['template'] ?? '',
      ].join(':'),
    )
  }
  return parts.join('|')
}

export const useResources = create<ResourcesState>((set) => ({
  byConnection: {},
  setResources: (connectionId, resources, at) =>
    set((s) => {
      const signature = resourcesSignature(resources)
      const prev = s.byConnection[connectionId]
      if (prev && prev.signature === signature) {
        // Chỉ cập nhật timestamp — không đổi reference `resources` → Tree không rebuild.
        if (prev.at === at) return s
        return {
          byConnection: {
            ...s.byConnection,
            [connectionId]: { ...prev, at },
          },
        }
      }
      return {
        byConnection: {
          ...s.byConnection,
          [connectionId]: { resources, at, signature },
        },
      }
    }),
}))
