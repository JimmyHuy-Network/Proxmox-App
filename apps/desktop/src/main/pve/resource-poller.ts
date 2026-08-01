import type { ConnectionPool } from './connection-pool.ts'

/**
 * Poller `/cluster/resources` chạy trong main process.
 *
 * Chạy trong main thay vì renderer để tiếp tục poll cả khi cửa sổ thu nhỏ hoặc
 * renderer chuyển route — nguồn sự thật cho cây tài nguyên và dashboard không nên
 * phụ thuộc vào view nào đang mở.
 *
 * Đếm số người theo dõi (ref-count) theo từng kết nối: nhiều view cùng cần dữ liệu
 * của một cluster thì chỉ poll một lần, và dừng hẳn khi không còn ai theo dõi —
 * không âm thầm poll một kết nối không ai xem.
 */

const POLL_INTERVAL_MS = 3000

export type ResourcesListener = (connectionId: string, resources: unknown[], at: number) => void

interface Watch {
  refCount: number
  timer: NodeJS.Timeout | null
  inFlight: boolean
}

export class ResourcePoller {
  private readonly pool: ConnectionPool
  private readonly emit: ResourcesListener
  private readonly watches = new Map<string, Watch>()

  constructor(pool: ConnectionPool, emit: ResourcesListener) {
    this.pool = pool
    this.emit = emit
  }

  /** Bắt đầu theo dõi một kết nối. Trả về hàm hủy theo dõi. */
  subscribe(connectionId: string): () => void {
    let watch = this.watches.get(connectionId)
    if (!watch) {
      watch = { refCount: 0, timer: null, inFlight: false }
      this.watches.set(connectionId, watch)
    }

    watch.refCount += 1
    if (watch.refCount === 1) this.startPolling(connectionId, watch)

    let unsubscribed = false
    return () => {
      if (unsubscribed) return // an toàn khi gọi lặp
      unsubscribed = true
      this.unsubscribe(connectionId)
    }
  }

  private unsubscribe(connectionId: string): void {
    const watch = this.watches.get(connectionId)
    if (!watch) return

    watch.refCount -= 1
    if (watch.refCount <= 0) {
      if (watch.timer) clearTimeout(watch.timer)
      this.watches.delete(connectionId)
    }
  }

  private startPolling(connectionId: string, watch: Watch): void {
    const tick = async (): Promise<void> => {
      // Watch đã bị gỡ (hết người theo dõi) trong lúc request đang bay — dừng luôn.
      if (!this.watches.has(connectionId)) return

      watch.inFlight = true
      try {
        const resources = (await this.pool.request(
          connectionId,
          'GET',
          '/cluster/resources',
          {},
        )) as unknown[]
        this.emit(connectionId, resources, Date.now())
      } catch {
        // Lỗi tạm thời (mạng, ticket hết hạn đang gia hạn) — cứ poll tiếp ở nhịp
        // sau. Nếu kết nối thật sự hỏng, sự kiện 'auth' từ pool đã báo rồi.
      } finally {
        watch.inFlight = false
      }

      if (!this.watches.has(connectionId)) return
      watch.timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      watch.timer.unref?.()
    }

    void tick() // lấy dữ liệu ngay, không đợi hết nhịp đầu tiên
  }

  stopAll(): void {
    for (const watch of this.watches.values()) {
      if (watch.timer) clearTimeout(watch.timer)
    }
    this.watches.clear()
  }
}
