import { describe, expect, it } from 'vitest'
import { synthRrd } from './rrd.ts'

describe('synthRrd', () => {
  it('sinh đúng 70 điểm cho mọi khung thời gian', () => {
    const bounds = { maxcpu: 4, maxmem: 4_294_967_296, maxdisk: 34_359_738_368 }
    for (const timeframe of ['hour', 'day', 'week', 'month', 'year']) {
      const points = synthRrd('pve1/qemu/100', timeframe, bounds, 'guest')
      expect(points, timeframe).toHaveLength(70)
    }
  })

  it('mốc thời gian tăng dần và cách đều theo bước của khung', () => {
    const bounds = { maxcpu: 4, maxmem: 4_294_967_296, maxdisk: 34_359_738_368 }
    const points = synthRrd('pve1/qemu/100', 'hour', bounds, 'guest')

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1]!, curr = points[i]!
      expect(curr['time']).toBeGreaterThan(prev['time']!)
      expect(curr['time']! - prev['time']!).toBe(60) // bước 60 giây của khung 'hour'
    }
  })

  it('mọi giá trị nằm trong biên đã khai báo', () => {
    const bounds = { maxcpu: 4, maxmem: 4_294_967_296, maxdisk: 34_359_738_368 }
    const points = synthRrd('pve1/qemu/100', 'hour', bounds, 'guest')

    for (const p of points) {
      expect(p['cpu']).toBeGreaterThanOrEqual(0)
      expect(p['cpu']).toBeLessThanOrEqual(1)
      expect(p['mem']).toBeGreaterThanOrEqual(0)
      expect(p['mem']).toBeLessThanOrEqual(bounds.maxmem)
      expect(p['disk']).toBeLessThanOrEqual(bounds.maxdisk)
      expect(p['maxcpu']).toBe(bounds.maxcpu)
      expect(p['maxmem']).toBe(bounds.maxmem)
    }
  })

  it('cùng seed cho cùng dữ liệu — biểu đồ không nhảy lung tung mỗi lần vẽ lại', () => {
    const bounds = { maxcpu: 4, maxmem: 4_294_967_296, maxdisk: 34_359_738_368 }
    const a = synthRrd('pve1/qemu/100', 'hour', bounds, 'guest')
    const b = synthRrd('pve1/qemu/100', 'hour', bounds, 'guest')
    // Không so trực tiếp mảng vì `time` phụ thuộc Date.now() tại lúc gọi (có thể
    // lệch vài mili giây giữa hai lần gọi) — so phần giá trị đo được.
    expect(a.map((p) => p['cpu'])).toEqual(b.map((p) => p['cpu']))
    expect(a.map((p) => p['mem'])).toEqual(b.map((p) => p['mem']))
  })

  it('seed khác nhau cho dữ liệu khác nhau — mỗi guest có biểu đồ riêng biệt', () => {
    const bounds = { maxcpu: 4, maxmem: 4_294_967_296, maxdisk: 34_359_738_368 }
    const a = synthRrd('pve1/qemu/100', 'hour', bounds, 'guest')
    const b = synthRrd('pve1/qemu/101', 'hour', bounds, 'guest')
    expect(a.map((p) => p['cpu'])).not.toEqual(b.map((p) => p['cpu']))
  })

  it('chỉ guest mới có netin/netout/diskread/diskwrite, node thì không', () => {
    const bounds = { maxcpu: 16, maxmem: 68_719_476_736, maxdisk: 107_374_182_400 }
    const guestPoints = synthRrd('pve1', 'hour', bounds, 'guest')
    const nodePoints = synthRrd('pve1', 'hour', bounds, 'node')

    expect(guestPoints[0]).toHaveProperty('netin')
    expect(nodePoints[0]).not.toHaveProperty('netin')
  })

  it('dùng timeframe hour khi giá trị không hợp lệ, không ném lỗi', () => {
    const bounds = { maxcpu: 4, maxmem: 4_294_967_296, maxdisk: 34_359_738_368 }
    const points = synthRrd('pve1/qemu/100', 'khong-hop-le', bounds, 'guest')
    expect(points).toHaveLength(70)
  })
})
