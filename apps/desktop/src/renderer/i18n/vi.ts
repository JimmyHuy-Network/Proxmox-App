/**
 * Chuỗi giao diện tiếng Việt.
 *
 * Quy ước dịch thuật cho toàn dự án:
 *  - Giữ nguyên tiếng Anh các thuật ngữ đã là danh từ riêng trong Proxmox:
 *    VM, LXC, node, cluster, storage, snapshot, backup, pool, datacenter, template.
 *    Dịch chúng ra sẽ khiến người dùng không đối chiếu được với tài liệu Proxmox.
 *  - Dịch các động từ và nhãn thao tác: Start → Khởi động, Shutdown → Tắt máy.
 *  - Xưng hô trung tính, không dùng "bạn" trong thông báo lỗi hệ thống.
 */
export const vi = {
  app: {
    name: 'Proxmox VE',
    tagline: 'Quản lý hạ tầng ảo hoá',
  },
  nav: {
    dashboard: 'Tổng quan',
    console: 'Console',
    connections: 'Kết nối',
    settings: 'Cài đặt',
  },
  dashboard: {
    title: 'Tổng quan',
    noConnection: 'Chưa có kết nối nào',
    noConnectionHint:
      'Giai đoạn 2 sẽ bổ sung phần quản lý kết nối tới nhiều cluster Proxmox. Hiện tại có thể dùng thử console giả lập để kiểm tra đường đi kỹ thuật.',
    openConsole: 'Mở console giả lập',
  },
  console: {
    title: 'Console',
    demoBadge: 'Giả lập',
    connecting: 'Đang kết nối…',
    connected: 'Đã kết nối',
    disconnected: 'Đã ngắt kết nối',
    failed: 'Kết nối thất bại',
    reconnect: 'Kết nối lại',
    clear: 'Xoá màn hình',
    hint: 'Hãy thử gõ tiếng Việt có dấu để kiểm tra việc đóng khung UTF-8.',
  },
  status: {
    running: 'Đang chạy',
    stopped: 'Đã dừng',
    paused: 'Tạm dừng',
    unknown: 'Không rõ',
  },
  common: {
    ok: 'Đồng ý',
    cancel: 'Huỷ',
    close: 'Đóng',
    retry: 'Thử lại',
    loading: 'Đang tải…',
    error: 'Lỗi',
    version: 'Phiên bản',
  },
  tasks: {
    dockTitle: 'Nhật ký tác vụ',
    empty: 'Chưa có tác vụ nào',
  },
  connections: {
    title: 'Kết nối',
    add: 'Thêm kết nối',
    edit: 'Sửa kết nối',
    empty: 'Chưa có kết nối nào',
    emptyHint: 'Thêm một cluster hoặc host Proxmox để bắt đầu quản lý.',
    name: 'Tên hiển thị',
    host: 'Địa chỉ máy chủ',
    port: 'Cổng',
    authMode: 'Cách xác thực',
    authTicket: 'Tên đăng nhập + mật khẩu',
    authToken: 'API Token',
    username: 'Tên đăng nhập',
    usernameHint: 'Dạng user@realm, ví dụ root@pam',
    password: 'Mật khẩu',
    passwordKeepHint: 'Để trống nếu không đổi mật khẩu đã lưu',
    tokenId: 'Tên token',
    tokenSecret: 'Chuỗi bí mật token',
    savePassword: 'Lưu mật khẩu (mã hóa trên máy)',
    test: 'Kiểm tra',
    save: 'Lưu',
    connect: 'Kết nối',
    disconnect: 'Ngắt kết nối',
    remove: 'Xóa',
    removeConfirm: 'Xóa kết nối này? Credential đã lưu cũng bị xóa.',
    testing: 'Đang kiểm tra…',
    connecting: 'Đang kết nối…',
    testOk: 'Kết nối tốt — Proxmox VE {{version}}',
    status: {
      idle: 'Chưa kết nối',
      connecting: 'Đang kết nối',
      'cert-challenge': 'Chờ xác nhận chứng chỉ',
      'tfa-challenge': 'Chờ mã OTP',
      authenticated: 'Đã kết nối',
      renewing: 'Đang gia hạn',
      degraded: 'Trục trặc',
      failed: 'Thất bại',
    },
  },
  cert: {
    title: 'Xác nhận chứng chỉ máy chủ',
    intro:
      'Máy chủ dùng chứng chỉ tự ký. Hãy đối chiếu vân tay dưới đây với kết quả lệnh "pvenode cert info" trên server trước khi tin tưởng.',
    fingerprint: 'Vân tay SHA-256',
    subject: 'Chủ thể',
    issuer: 'Nơi cấp',
    validFrom: 'Hiệu lực từ',
    validTo: 'Hết hạn',
    trust: 'Tin tưởng và kết nối',
    cancel: 'Hủy',
    mismatch: 'Vân tay chứng chỉ đã thay đổi — kết nối bị chặn để đề phòng tấn công.',
  },
  tfa: {
    title: 'Xác thực hai lớp',
    intro: 'Nhập mã OTP từ ứng dụng xác thực của bạn.',
    code: 'Mã OTP',
    submit: 'Xác nhận',
    invalid: 'Mã OTP không đúng',
  },
}

/**
 * Cố ý KHÔNG dùng `as const` ở trên. Với `as const`, mỗi giá trị trở thành kiểu
 * literal đúng chuỗi tiếng Việt đó, và bản dịch tiếng Anh sẽ không bao giờ gán được.
 * Bỏ nó đi thì khoá vẫn được suy luận đầy đủ (đó là thứ `t()` cần), còn giá trị nới
 * thành `string` để mọi ngôn ngữ đều hợp lệ.
 */
export type TranslationSchema = typeof vi
