import { create } from 'zustand'
import type { ConnectionPhase, ConnectionSummary } from '@pve/ipc'

/**
 * Trạng thái client cho các kết nối: danh sách, kết nối đang chọn, và pha xác thực
 * hiện tại của từng cái.
 *
 * Đây là trạng thái CLIENT thuần (lựa chọn của người dùng, trạng thái phù du) nên
 * nằm ở zustand. Dữ liệu Proxmox thật thuộc về TanStack Query, không để ở đây.
 */
interface ConnectionsState {
  connections: ConnectionSummary[]
  activeId: string | null
  /** Pha xác thực mới nhất theo connectionId, cập nhật từ sự kiện pve:event. */
  phases: Record<string, ConnectionPhase>

  setConnections: (list: ConnectionSummary[]) => void
  setActive: (id: string | null) => void
  setPhase: (id: string, phase: ConnectionPhase) => void
  refresh: () => Promise<void>
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  connections: [],
  activeId: null,
  phases: {},

  setConnections: (list) => set({ connections: list }),
  setActive: (id) => set({ activeId: id }),
  setPhase: (id, phase) => set((s) => ({ phases: { ...s.phases, [id]: phase } })),

  refresh: async () => {
    const res = await window.pve.vault.list()
    if (!res.ok) return
    set({ connections: res.data })

    // Giữ lựa chọn hiện tại nếu còn tồn tại, nếu không chọn cái đầu tiên.
    const { activeId } = get()
    if (!activeId || !res.data.some((c) => c.id === activeId)) {
      set({ activeId: res.data[0]?.id ?? null })
    }
  },
}))

/** Đăng ký nhận sự kiện đổi pha xác thực từ main. Gọi một lần khi app khởi động. */
export function subscribeConnectionEvents(): () => void {
  return window.pve.onEvent((event) => {
    if (event.kind === 'auth') {
      useConnections.getState().setPhase(event.connectionId, event.phase)
    }
  })
}
