import type { PveParamSpec, PveReturnSpec } from '@pve/schema'

/**
 * Sinh phản hồi đúng hình dạng `returns` cho những endpoint chưa có handler riêng.
 *
 * Đây là điểm ăn tiền của việc định tuyến theo schema: **cả 675 endpoint đều trả
 * lời hợp lệ ngay từ ngày đầu**, nên dựng được giao diện cho HA hay Ceph từ rất sớm,
 * trước khi viết logic thật cho chúng.
 *
 * Dữ liệu sinh ra là tất định (dựa trên seed lấy từ đường dẫn), nên chạy lại test
 * cho cùng kết quả và diff của snapshot không nhiễu.
 */

/** PRNG tất định — cùng seed thì cùng dãy số. */
function makeRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 100000) / 100000
  }
}

function fakeString(spec: PveParamSpec, rand: () => number, key: string): string {
  if (spec.enum && spec.enum.length > 0) {
    return spec.enum[Math.floor(rand() * spec.enum.length)] ?? (spec.enum[0] as string)
  }

  const format = typeof spec.format === 'string' ? spec.format : ''

  switch (format) {
    case 'pve-node':
      return 'pve1'
    case 'pve-storage-id':
      return 'local'
    case 'pve-userid':
      return 'root@pam'
    case 'pve-realm':
      return 'pam'
    case 'mac-addr':
      return 'AA:BB:CC:DD:EE:FF'
    case 'ip':
    case 'ipv4':
    case 'address':
      return '192.168.1.10'
    case 'ipv6':
      return 'fd00::1'
    case 'CIDR':
    case 'IPorCIDR':
      return '192.168.1.0/24'
    case 'dns-name':
      return 'pve1.local'
    case 'pve-iface':
      return 'vmbr0'
    default:
      break
  }

  // Vài tên trường phổ biến đáng có giá trị nhìn hợp lý, vì chúng hiện thẳng
  // lên giao diện trong lúc phát triển.
  if (/^(name|hostname)$/i.test(key)) return 'muc-vi-du'
  if (/type$/i.test(key)) return 'dir'
  if (/status$/i.test(key)) return 'running'
  if (/version$/i.test(key)) return '9.2.1'

  return `${key}-gia-lap`
}

function fakeValue(spec: PveParamSpec, rand: () => number, key: string, depth: number): unknown {
  if (depth > 4) return null

  switch (spec.type) {
    case 'string':
      return fakeString(spec, rand, key)

    case 'integer': {
      const min = spec.minimum ?? 0
      const max = spec.maximum ?? Math.max(min + 100, 100)
      return Math.floor(min + rand() * Math.min(max - min, 1000))
    }

    case 'number': {
      const min = spec.minimum ?? 0
      const max = spec.maximum ?? min + 1
      return Number((min + rand() * (max - min)).toFixed(3))
    }

    // Proxmox truyền boolean dưới dạng 0/1 trên dây, nên phải giả lập đúng như vậy —
    // trả về true/false ở đây sẽ che mất lỗi giải mã phía client.
    case 'boolean':
      return rand() > 0.5 ? 1 : 0

    case 'array': {
      const items = spec.items
      if (!items) return []
      return [0, 1].map((i) => fakeValue(items, rand, `${key}-${i}`, depth + 1))
    }

    case 'object': {
      if (!spec.properties) return {}
      return fakeObject(spec.properties, rand, depth + 1)
    }

    case 'null':
      return null

    default:
      return null
  }
}

function fakeObject(
  properties: Record<string, PveParamSpec>,
  rand: () => number,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, spec] of Object.entries(properties)) {
    // Trường tuỳ chọn thỉnh thoảng vắng mặt — đúng như thật, và đó là cách bắt
    // được chỗ nào ở client quên kiểm tra undefined.
    if (spec.optional && rand() > 0.7) continue
    result[key] = fakeValue(spec, rand, key, depth)
  }

  return result
}

export function fakeFromReturns(spec: PveReturnSpec | undefined, seed: string): unknown {
  if (!spec) return null

  const rand = makeRandom(seed)

  switch (spec.type) {
    case 'array': {
      const items = spec.items
      if (items?.properties) {
        return [0, 1, 2].map((i) => fakeObject(items.properties!, makeRandom(`${seed}#${i}`), 0))
      }
      return []
    }

    case 'object':
      return spec.properties ? fakeObject(spec.properties, rand, 0) : {}

    case 'null':
      return null

    default:
      return fakeValue(spec, rand, 'ket-qua', 0)
  }
}
