import { create } from 'zustand'
import type { ClusterResource } from '../features/resources/types'

/**
 * Guest đang được chọn để xem chi tiết (mở từ cây tài nguyên).
 *
 * Tách thành store riêng vì cây tài nguyên nằm trong `Sider` còn khung xem chi
 * tiết (drawer) nằm ở cấp `AppLayout` — không có quan hệ cha-con trực tiếp để
 * truyền prop.
 */
interface SelectionState {
  selectedGuest: ClusterResource | null
  select: (guest: ClusterResource | null) => void
}

export const useSelection = create<SelectionState>((set) => ({
  selectedGuest: null,
  select: (guest) => set({ selectedGuest: guest }),
}))
