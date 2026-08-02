/**
 * Tên các kênh IPC. Cố ý giữ ở mức tối thiểu.
 *
 * Không tạo kênh riêng cho từng endpoint Proxmox — schema PVE 9.2 có 675 endpoint,
 * và một kênh cho mỗi endpoint vừa không bảo trì nổi vừa không an toàn hơn chút nào.
 * An toàn kiểu đến từ bản đồ endpoint sinh tự động (@pve/api), còn kiểm soát truy cập
 * đến từ validator danh sách trắng trong main. Xem `PveRequestEnvelope`.
 */
export const IpcChannel = {
  /** Gọi REST tới Proxmox. Main xác thực path/method/params trước khi chuyển tiếp. */
  PveRequest: 'pve:request',
  /** Huỷ một request đang bay. AbortSignal không đi qua được IPC nên phải làm thủ công. */
  PveCancel: 'pve:cancel',
  /** Đăng ký nhận một luồng đẩy (task, resource tick, log tail...). */
  PveStreamStart: 'pve:stream:start',
  /** Huỷ đăng ký luồng đẩy. */
  PveStreamStop: 'pve:stream:stop',
  /** Kênh đẩy đa hợp main → renderer. Payload là union phân biệt theo `kind`. */
  PveEvent: 'pve:event',

  /** Quản lý kho kết nối (nhiều cluster). */
  Vault: 'app:vault',
  /** Mở/đóng phiên console, trả về URL relay nội bộ. */
  Console: 'app:console',
  /**
   * Upload/download file lớn — stream qua main (không đi qua renderer).
   * Tiến trình đẩy qua `PveEvent` kind `transfer`.
   */
  Transfer: 'pve:transfer',
  /** Các lời gọi cấp ứng dụng: phiên bản, mở link ngoài, log, cập nhật. */
  App: 'app:misc',
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]
