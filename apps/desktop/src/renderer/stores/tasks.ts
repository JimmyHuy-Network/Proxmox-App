import { create } from 'zustand'
import type { TaskPhase } from '@pve/ipc'

export interface TaskLogLine {
  n: number
  t: string
}

export interface TaskEntry {
  connectionId: string
  upid: string
  phase: TaskPhase
  exitstatus?: string
  log: TaskLogLine[]
  startedAt: number
}

interface TasksState {
  byUpid: Record<string, TaskEntry>
  /**
   * Thêm một tác vụ ngay khi renderer nhận được UPID từ `pveRequest`, TRƯỚC khi sự
   * kiện `pve:event` đầu tiên kịp tới. Main đã tự động theo dõi (xem task-tracker.ts)
   * nên sự kiện chắc chắn sẽ đến; đây chỉ là cập nhật lạc quan để dock hiện ngay tức
   * khắc thay vì chờ một vòng round-trip nữa.
   */
  addTask: (connectionId: string, upid: string) => void
  applyPhase: (connectionId: string, upid: string, phase: TaskPhase, exitstatus?: string) => void
  appendLog: (connectionId: string, upid: string, lines: TaskLogLine[]) => void
}

function ensure(
  byUpid: Record<string, TaskEntry>,
  connectionId: string,
  upid: string,
): TaskEntry {
  return byUpid[upid] ?? { connectionId, upid, phase: 'started', log: [], startedAt: Date.now() }
}

export const useTasks = create<TasksState>((set) => ({
  byUpid: {},

  addTask: (connectionId, upid) =>
    set((s) => (s.byUpid[upid] ? s : { byUpid: { ...s.byUpid, [upid]: ensure(s.byUpid, connectionId, upid) } })),

  applyPhase: (connectionId, upid, phase, exitstatus) =>
    set((s) => ({
      byUpid: {
        ...s.byUpid,
        [upid]: { ...ensure(s.byUpid, connectionId, upid), phase, ...(exitstatus ? { exitstatus } : {}) },
      },
    })),

  appendLog: (connectionId, upid, lines) =>
    set((s) => {
      const existing = ensure(s.byUpid, connectionId, upid)
      return { byUpid: { ...s.byUpid, [upid]: { ...existing, log: [...existing.log, ...lines] } } }
    }),
}))

/** Danh sách tác vụ gần đây nhất, mới nhất trước — dùng cho dock. */
export function recentTasks(byUpid: Record<string, TaskEntry>, limit = 20): TaskEntry[] {
  return Object.values(byUpid)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
}
