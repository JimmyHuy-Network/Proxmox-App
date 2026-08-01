import { describe, expect, it } from 'vitest'
import {
  POSITIONAL_KEY,
  formatPropertyString,
  parsePropertyString,
  parseSize,
  propBool,
  propNumber,
} from './property-string.ts'
import { PVE_PROPERTY_SCHEMAS } from '../generated/property-schemas.ts'

const netSchema = PVE_PROPERTY_SCHEMAS['qemu.net']
const scsiSchema = PVE_PROPERTY_SCHEMAS['scsi']

describe('parsePropertyString', () => {
  it('phân tích cặp khoá–giá trị đơn giản', () => {
    expect(parsePropertyString('bridge=vmbr0,firewall=1')).toEqual({
      bridge: 'vmbr0',
      firewall: '1',
    })
  })

  it('gán giá trị vị trí vào đúng trường default_key khi có schema', () => {
    // `scsi0: "local-lvm:vm-100-disk-0,size=32G"` — phần đầu chính là `file`.
    const parsed = parsePropertyString('local-lvm:vm-100-disk-0,size=32G,iothread=1', scsiSchema)
    expect(parsed['file']).toBe('local-lvm:vm-100-disk-0')
    expect(parsed['size']).toBe('32G')
    expect(parsed['iothread']).toBe('1')
  })

  it('giữ giá trị vị trí dưới khoá riêng khi không có schema', () => {
    const parsed = parsePropertyString('local-lvm:vm-100-disk-0,size=32G')
    expect(parsed[POSITIONAL_KEY]).toBe('local-lvm:vm-100-disk-0')
    expect(parsed['size']).toBe('32G')
  })

  it('nở bí danh model card mạng thành hai trường', () => {
    // Đây là chỗ dễ sai nhất. `net0: "virtio=AA:BB:..."` KHÔNG có trường tên
    // `virtio` — schema khai báo nó là bí danh của `macaddr` kèm keyAlias `model`.
    const parsed = parsePropertyString('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0', netSchema)
    expect(parsed['macaddr']).toBe('AA:BB:CC:DD:EE:FF')
    expect(parsed['model']).toBe('virtio')
    expect(parsed['bridge']).toBe('vmbr0')
    expect(parsed['virtio']).toBeUndefined()
  })

  it('nở được cả bí danh của các model e1000', () => {
    const parsed = parsePropertyString('e1000=12:34:56:78:9A:BC', netSchema)
    expect(parsed['macaddr']).toBe('12:34:56:78:9A:BC')
    expect(parsed['model']).toBe('e1000')
  })

  it('giữ nguyên dấu hai chấm trong giá trị', () => {
    const parsed = parsePropertyString('file=local:100/vm-100-disk-1.raw,mp=/data')
    expect(parsed['file']).toBe('local:100/vm-100-disk-1.raw')
    expect(parsed['mp']).toBe('/data')
  })

  it('giữ dấu bằng nằm bên trong giá trị', () => {
    // Chỉ tách ở dấu bằng ĐẦU TIÊN.
    expect(parsePropertyString('args=-device foo=bar')).toEqual({ args: '-device foo=bar' })
  })

  it('bỏ qua phần rỗng và khoảng trắng thừa', () => {
    expect(parsePropertyString(' bridge = vmbr0 , , firewall=1 ')).toEqual({
      bridge: 'vmbr0',
      firewall: '1',
    })
  })

  it('chỉ nhận một giá trị vị trí', () => {
    const parsed = parsePropertyString('first,second,key=v')
    expect(parsed[POSITIONAL_KEY]).toBe('first')
    expect(parsed['key']).toBe('v')
  })

  it('trả về object rỗng với chuỗi rỗng', () => {
    expect(parsePropertyString('')).toEqual({})
  })
})

describe('formatPropertyString', () => {
  it('đặt giá trị vị trí lên đầu', () => {
    const out = formatPropertyString(
      { size: '32G', file: 'local-lvm:vm-100-disk-0', iothread: true },
      scsiSchema,
    )
    expect(out.startsWith('local-lvm:vm-100-disk-0')).toBe(true)
    expect(out).toContain('size=32G')
    expect(out).toContain('iothread=1')
  })

  it('chuyển boolean thành 0/1 theo đúng quy ước Proxmox', () => {
    expect(formatPropertyString({ firewall: true, link_down: false })).toBe(
      'firewall=1,link_down=0',
    )
  })

  it('bỏ qua undefined và null', () => {
    expect(formatPropertyString({ a: '1', b: undefined, c: null, d: 2 })).toBe('a=1,d=2')
  })

  it('khứ hồi được cấu hình đĩa thật', () => {
    const original = 'local-lvm:vm-100-disk-0,size=32G,iothread=1'
    const parsed = parsePropertyString(original, scsiSchema)
    const again = parsePropertyString(formatPropertyString(parsed, scsiSchema), scsiSchema)
    expect(again).toEqual(parsed)
  })
})

describe('trợ giúp đọc giá trị', () => {
  it('propBool hiểu quy ước 0/1', () => {
    expect(propBool({ a: '1' }, 'a')).toBe(true)
    expect(propBool({ a: '0' }, 'a')).toBe(false)
    expect(propBool({}, 'a')).toBeUndefined()
  })

  it('propNumber bỏ qua giá trị không phải số', () => {
    expect(propNumber({ a: '42' }, 'a')).toBe(42)
    expect(propNumber({ a: 'abc' }, 'a')).toBeUndefined()
  })

  it('parseSize hiểu hậu tố của Proxmox', () => {
    expect(parseSize('32G')).toBe(32 * 1024 ** 3)
    expect(parseSize('512M')).toBe(512 * 1024 ** 2)
    expect(parseSize('1T')).toBe(1024 ** 4)
    expect(parseSize('4096')).toBe(4096)
    expect(parseSize('không phải số')).toBeUndefined()
    expect(parseSize(undefined)).toBeUndefined()
  })
})

describe('schema property string sinh tự động', () => {
  it('gộp trùng nhưng vẫn giữ hai biến thể của net', () => {
    expect(PVE_PROPERTY_SCHEMAS['qemu.net']).toBeDefined()
    expect(PVE_PROPERTY_SCHEMAS['lxc.net']).toBeDefined()
    expect(PVE_PROPERTY_SCHEMAS['qemu.net']).not.toEqual(PVE_PROPERTY_SCHEMAS['lxc.net'])
  })

  it('có đủ các schema đĩa quan trọng', () => {
    for (const name of ['scsi', 'virtio', 'ide', 'sata', 'mp', 'rootfs', 'efidisk0']) {
      expect(PVE_PROPERTY_SCHEMAS[name], `thiếu schema ${name}`).toBeDefined()
    }
  })

  it('đánh dấu đúng trường default_key của schema đĩa', () => {
    const entries = Object.entries(scsiSchema ?? {})
    const defaultKeys = entries.filter(([, v]) => (v as { defaultKey?: boolean }).defaultKey)
    expect(defaultKeys.map(([k]) => k)).toEqual(['file'])
  })
})
