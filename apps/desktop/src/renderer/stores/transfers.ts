import { create } from 'zustand'
import type { TransferEvent, TransferKind, TransferPhase } from '@pve/ipc'

export interface TransferState {
  transferId: string
  connectionId: string
  transferKind: TransferKind
  phase: TransferPhase
  bytesSent: number
  totalBytes: number
  upid?: string
  message?: string
}

interface TransfersStore {
  items: Record<string, TransferState>
  apply: (event: TransferEvent) => void
  clear: (transferId: string) => void
}

export const useTransfers = create<TransfersStore>((set) => ({
  items: {},
  apply: (event) =>
    set((state) => ({
      items: {
        ...state.items,
        [event.transferId]: {
          transferId: event.transferId,
          connectionId: event.connectionId,
          transferKind: event.transferKind,
          phase: event.phase,
          bytesSent: event.bytesSent ?? state.items[event.transferId]?.bytesSent ?? 0,
          totalBytes: event.totalBytes ?? state.items[event.transferId]?.totalBytes ?? 0,
          ...(event.upid ? { upid: event.upid } : {}),
          ...(event.message ? { message: event.message } : {}),
        },
      },
    })),
  clear: (transferId) =>
    set((state) => {
      const next = { ...state.items }
      delete next[transferId]
      return { items: next }
    }),
}))
