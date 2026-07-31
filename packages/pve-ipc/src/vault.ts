/**
 * Cách một kết nối tự xác thực.
 *
 * `ticket` — đăng nhập username/password, có thể kèm TOTP. Ticket sống 2 giờ.
 *   Đây là chế độ **duy nhất** mở được console terminal, vì Proxmox từ chối
 *   API Token trên endpoint `/termproxy`.
 * `token` — header `Authorization: PVEAPIToken=...`. Không cần CSRF, không hết hạn,
 *   thu hồi được riêng lẻ, nhưng bị chặn ở mọi endpoint có `allowtoken: 0`.
 */
export type AuthMode = 'ticket' | 'token'

/** Phần thông tin kết nối an toàn để gửi sang renderer — không chứa bí mật. */
export interface ConnectionSummary {
  id: string
  name: string
  host: string
  port: number
  authMode: AuthMode
  /** `user@realm`, ví dụ `root@pam`. */
  username: string
  /** Có credential lưu sẵn hay không. Nếu không, mỗi lần chạy phải nhập lại. */
  hasStoredSecret: boolean
  /** Đã ghim vân tay chứng chỉ chưa (trust-on-first-use). */
  certPinned: boolean
  /**
   * Kết nối dùng API Token nhưng có kèm mật khẩu để mở console khi cần.
   * Đây là lý do một kết nối có thể giữ cả hai loại credential.
   */
  hasConsoleCredential: boolean
}

/** Dữ liệu tạo/sửa kết nối. Trường bí mật chỉ đi một chiều: renderer → main. */
export interface ConnectionInput {
  id?: string
  name: string
  host: string
  port: number
  authMode: AuthMode
  username: string
  /** Chỉ dùng khi authMode là 'ticket'. Bỏ trống nghĩa là hỏi mỗi lần khởi động. */
  password?: string
  /** Chỉ dùng khi authMode là 'token'. Dạng `tên-token`, không kèm user@realm. */
  tokenId?: string
  tokenSecret?: string
  /** Cho phép kết nối tới chứng chỉ tự ký sau khi người dùng đã xác nhận vân tay. */
  allowSelfSigned: boolean
}

export interface CertInfo {
  fingerprint256: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
}

/** Kết quả thử kết nối, dùng cho nút "Kiểm tra" trong form thêm cluster. */
export type TestConnectionResult =
  | { status: 'ok'; version: string; release: string; clusterName?: string }
  | { status: 'cert-untrusted'; cert: CertInfo }
  | { status: 'tfa-required'; challenge: string }
  | { status: 'error'; message: string }
