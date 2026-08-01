export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

/**
 * Số điểm và bước thời gian cho từng khung — khớp cấu trúc RRA thật của Proxmox
 * đủ để mã vẽ biểu đồ ở renderer được luyện đúng, dù giá trị là giả lập.
 */
const TIMEFRAME_STEPS: Record<Timeframe, { count: number; stepSec: number }> = {
  hour: { count: 70, stepSec: 60 },
  day: { count: 70, stepSec: 1800 },
  week: { count: 70, stepSec: 7200 },
  month: { count: 70, stepSec: 43_200 },
  year: { count: 70, stepSec: 604_800 },
}

/** PRNG tất định (mulberry32) — cùng seed cho cùng kết quả giữa các lần gọi. */
function makeRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export interface RrdBounds {
  maxcpu: number
  maxmem: number
  maxdisk: number
}

/**
 * Sinh chuỗi thời gian giả lập cho RRD, dao động hình sin cộng nhiễu để biểu đồ
 * trông "sống" và có thể tái lập (cùng seed → cùng dữ liệu), thay vì chỉ vài điểm
 * ngẫu nhiên rời rạc như bộ auto-faker chung tạo ra.
 *
 * Là ranh giới rõ ràng để biết cần bao nhiêu điểm và bước bao nhiêu giây cho mỗi
 * `timeframe` — thứ mà mã vẽ biểu đồ ở renderer phải xử lý đúng ngay từ mock.
 */
export function synthRrd(
  seed: string,
  timeframe: string,
  bounds: RrdBounds,
  kind: 'node' | 'guest',
): Record<string, number>[] {
  const cfg = TIMEFRAME_STEPS[timeframe as Timeframe] ?? TIMEFRAME_STEPS.hour
  const rand = makeRandom(seed)
  const now = Math.floor(Date.now() / 1000)

  const points: Record<string, number>[] = []

  for (let i = cfg.count - 1; i >= 0; i -= 1) {
    const time = now - i * cfg.stepSec
    const phase = (i / cfg.count) * Math.PI * 4

    const cpuFrac = clamp(0.15 + 0.12 * Math.sin(phase) + (rand() - 0.5) * 0.06, 0.01, 0.95)
    const memFrac = clamp(0.45 + 0.15 * Math.sin(phase * 0.6 + 1) + (rand() - 0.5) * 0.05, 0.1, 0.92)
    const diskFrac = clamp(0.3 + (cfg.count - i) * 0.0005 + (rand() - 0.5) * 0.01, 0.05, 0.95)

    const point: Record<string, number> = {
      time,
      cpu: Number(cpuFrac.toFixed(4)),
      maxcpu: bounds.maxcpu,
      mem: Math.round(memFrac * bounds.maxmem),
      maxmem: bounds.maxmem,
      disk: Math.round(diskFrac * bounds.maxdisk),
      maxdisk: bounds.maxdisk,
    }

    if (kind === 'guest') {
      point['netin'] = Math.round(rand() * 200_000)
      point['netout'] = Math.round(rand() * 80_000)
      point['diskread'] = Math.round(rand() * 50_000)
      point['diskwrite'] = Math.round(rand() * 30_000)
    }

    points.push(point)
  }

  return points
}
