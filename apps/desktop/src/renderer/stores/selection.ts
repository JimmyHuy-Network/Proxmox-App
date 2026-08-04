import { create } from 'zustand'
import { isGuest, type ClusterResource } from '../features/resources/types'

/**
 * Tài nguyên đang được chọn để xem chi tiết (guest / storage / node).
 *
 * Tách thành store riêng vì cây tài nguyên nằm trong `Sider` còn khung xem chi
 * tiết (drawer) nằm ở cấp `AppLayout` — không có quan hệ cha-con trực tiếp để
 * truyền prop.
 */
interface SelectionState {
  selectedGuest: ClusterResource | null
  selectedStorage: ClusterResource | null
  selectedNode: ClusterResource | null
  /** Tab guest drawer cần mở sau khi select (vd. GlobalSearch → Console). */
  guestTargetTab: string | null
  selectGuest: (guest: ClusterResource | null, targetTab?: string | null) => void
  selectStorage: (storage: ClusterResource | null) => void
  selectNode: (node: ClusterResource | null) => void
  /** Chọn từ cây: tự phân loại; các lựa chọn khác bị xóa. */
  select: (resource: ClusterResource | null, targetTab?: string | null) => void
  clearGuestTargetTab: () => void
}

export const useSelection = create<SelectionState>((set) => ({
  selectedGuest: null,
  selectedStorage: null,
  selectedNode: null,
  guestTargetTab: null,
  selectGuest: (guest, targetTab = null) =>
    set({ selectedGuest: guest, selectedStorage: null, selectedNode: null, guestTargetTab: targetTab }),
  selectStorage: (storage) =>
    set({ selectedStorage: storage, selectedGuest: null, selectedNode: null, guestTargetTab: null }),
  selectNode: (node) =>
    set({ selectedNode: node, selectedGuest: null, selectedStorage: null, guestTargetTab: null }),
  select: (resource, targetTab = null) => {
    if (!resource) {
      set({ selectedGuest: null, selectedStorage: null, selectedNode: null, guestTargetTab: null })
      return
    }
    if (isGuest(resource)) {
      set({
        selectedGuest: resource,
        selectedStorage: null,
        selectedNode: null,
        guestTargetTab: targetTab,
      })
      return
    }
    if (resource.type === 'storage') {
      set({ selectedStorage: resource, selectedGuest: null, selectedNode: null, guestTargetTab: null })
      return
    }
    if (resource.type === 'node') {
      set({ selectedNode: resource, selectedGuest: null, selectedStorage: null, guestTargetTab: null })
      return
    }
    set({ selectedGuest: null, selectedStorage: null, selectedNode: null, guestTargetTab: null })
  },
  clearGuestTargetTab: () => set({ guestTargetTab: null }),
}))
