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
}

/**
 * Cố ý KHÔNG dùng `as const` ở trên. Với `as const`, mỗi giá trị trở thành kiểu
 * literal đúng chuỗi tiếng Việt đó, và bản dịch tiếng Anh sẽ không bao giờ gán được.
 * Bỏ nó đi thì khoá vẫn được suy luận đầy đủ (đó là thứ `t()` cần), còn giá trị nới
 * thành `string` để mọi ngôn ngữ đều hợp lệ.
 */
export type TranslationSchema = typeof vi
