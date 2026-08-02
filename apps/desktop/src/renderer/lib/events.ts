import { useConnections } from '../stores/connections'
import { useResources } from '../stores/resources'
import { useTasks } from '../stores/tasks'
import { useTransfers } from '../stores/transfers'
import { useUpdate } from '../stores/update'

/**
 * Điểm nhận duy nhất cho kênh `pve:event` đa hợp từ main.
 *
 * Main gộp mọi thứ (đổi pha xác thực, nhịp poll tài nguyên, tiến trình tác vụ, log)
 * vào một kênh, phân biệt bằng `kind`. Ở đây phân phối lại cho từng store — mỗi
 * store chỉ biết về phần dữ liệu của mình, không ai phải tự mở thêm listener IPC
 * riêng (mỗi listener thêm là một chỗ dễ quên gỡ đăng ký lúc unmount).
 *
 * Gọi một lần duy nhất khi app khởi động (trong `AppLayout`).
 */
export function subscribePveEvents(): () => void {
  return window.pve.onEvent((event) => {
    switch (event.kind) {
      case 'auth':
        useConnections.getState().setPhase(event.connectionId, event.phase)
        // E2E / kết nối từ main: đảm bảo activeId + list đồng bộ khi vừa authenticated.
        if (event.phase === 'authenticated') {
          const state = useConnections.getState()
          if (!state.activeId) state.setActive(event.connectionId)
          void state.refresh()
        }
        break

      case 'resources':
        useResources.getState().setResources(event.connectionId, event.resources, event.at)
        break

      case 'task':
        useTasks.getState().applyPhase(event.connectionId, event.upid, event.phase, event.exitstatus)
        break

      case 'log-chunk':
        useTasks.getState().appendLog(event.connectionId, event.upid, event.lines)
        break

      case 'transfer':
        useTransfers.getState().apply(event)
        break

      case 'update':
        useUpdate.getState().setStatus(event.status)
        break

      // 'cert-untrusted' và 'console-closed' được xử lý tại chỗ bởi luồng gọi
      // tương ứng (form kết nối, phiên console), không cần store toàn cục.
      default:
        break
    }
  })
}
