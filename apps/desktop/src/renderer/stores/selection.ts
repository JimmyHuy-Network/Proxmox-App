import { create } from 'zustand'
import { isGuest, type ClusterResource } from '../features/resources/types'

/**
 * Tài nguyên đang được chọn để xem chi tiết (guest hoặc storage).
 *
 * Tách thành store riêng vì cây tài nguyên nằm trong `Sider` còn khung xem chi
 * tiết (drawer) nằm ở cấp `AppLayout` — không có quan hệ cha-con trực tiếp để
 * truyền prop.
 */
interface SelectionState {
  selectedGuest: ClusterResource | null
  selectedStorage: ClusterResource | null
  selectGuest: (guest: ClusterResource | null) => void
  selectStorage: (storage: ClusterResource | null) => void
  /** Chọn từ cây: tự phân loại guest / storage; cái còn lại bị xóa. */
  select: (resource: ClusterResource | null) => void
}

export const useSelection = create<SelectionState>((set) => ({
  selectedGuest: null,
  selectedStorage: null,
  selectGuest: (guest) => set({ selectedGuest: guest, selectedStorage: null }),
  selectStorage: (storage) => set({ selectedStorage: storage, selectedGuest: null }),
  select: (resource) => {
    if (!resource) {
      set({ selectedGuest: null, selectedStorage: null })
      return
    }
    if (isGuest(resource)) {
      set({ selectedGuest: resource, selectedStorage: null })
      return
    }
    if (resource.type === 'storage') {
      set({ selectedStorage: resource, selectedGuest: null })
      return
    }
    set({ selectedGuest: null, selectedStorage: null })
  },
}))
