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
}

interface ResourcesState {
  byConnection: Record<string, ClusterResourcesEntry>
  setResources: (connectionId: string, resources: unknown[], at: number) => void
}

export const useResources = create<ResourcesState>((set) => ({
  byConnection: {},
  setResources: (connectionId, resources, at) =>
    set((s) => ({ byConnection: { ...s.byConnection, [connectionId]: { resources, at } } })),
}))
