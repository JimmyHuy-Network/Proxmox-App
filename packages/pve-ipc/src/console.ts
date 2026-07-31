export type ConsoleKind = 'vnc' | 'term' | 'spice'
export type PveGuestType = 'qemu' | 'lxc'

/**
 * Kết nối giả lập dùng cho spike và phát triển khi chưa có Proxmox thật.
 * Main nhận diện giá trị này và nối relay tới fake shell nội bộ thay vì đi ra ngoài.
 * Chỉ được đăng ký khi chạy dev — xem `registerConsoleHandlers`.
 */
export const DEMO_CONNECTION_ID = '__demo__'

export interface ConsoleOpenRequest {
  connectionId: string
  kind: ConsoleKind
  node: string
  /** Bỏ trống nghĩa là shell của chính node. */
  vmid?: number
  vmtype?: PveGuestType
}

export interface ConsoleOpenResult {
  sessionId: string
  /**
   * `ws://127.0.0.1:<cổng ephemeral>/s/<token>`.
   *
   * Token dùng một lần và hết hạn sau 30 giây. Renderer chỉ thấy URL loopback này;
   * ticket của Proxmox, cookie và host thật đều nằm lại trong main.
   */
  relayUrl: string
  kind: ConsoleKind
  /** Nhãn hiển thị trên tab console, ví dụ "pve1 — VM 100 (debian)". */
  title: string
}

/** Lý do một phiên console đóng lại, để renderer hiển thị thông báo đúng. */
export type ConsoleCloseReason =
  | 'client'
  | 'upstream-closed'
  | 'upstream-error'
  | 'auth-failed'
  | 'timeout'

export interface ConsoleClosedEvent {
  sessionId: string
  reason: ConsoleCloseReason
  message?: string
}
