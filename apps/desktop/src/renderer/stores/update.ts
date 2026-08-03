import { create } from 'zustand'
import type { UpdateStatus } from '@pve/ipc'

interface UpdateState {
  status: UpdateStatus
  setStatus: (status: UpdateStatus) => void
  refresh: () => Promise<void>
  check: () => Promise<void>
  install: () => Promise<void>
}

export const useUpdate = create<UpdateState>((set) => ({
  status: { state: 'idle' },
  setStatus: (status) => set({ status }),
  refresh: async () => {
    const res = await window.pve.app.getUpdateStatus()
    if (res.ok && res.data) set({ status: res.data })
  },
  check: async () => {
    const res = await window.pve.app.checkForUpdates()
    if (res.ok && res.data) set({ status: res.data })
  },
  install: async () => {
    await window.pve.app.quitAndInstall()
  },
}))
