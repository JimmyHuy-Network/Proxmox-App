import { useTasks, type TaskEntry } from '../stores/tasks'

/** Trạng thái hiện tại của một tác vụ theo UPID, cập nhật tự động qua sự kiện. */
export function useTask(upid: string | null): TaskEntry | undefined {
  return useTasks((s) => (upid ? s.byUpid[upid] : undefined))
}
