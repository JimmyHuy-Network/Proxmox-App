import { useConnections } from '../stores/connections'
import { useResources } from '../stores/resources'
import { useTasks } from '../stores/tasks'

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

      // 'cert-untrusted' và 'console-closed' được xử lý tại chỗ bởi luồng gọi
      // tương ứng (form kết nối, phiên console), không cần store toàn cục.
      default:
        break
    }
  })
}
