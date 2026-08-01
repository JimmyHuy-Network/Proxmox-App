import { PVE_PROPERTY_SCHEMAS, parsePropertyString, type PropertyStringSchema } from '@pve/api'

/** Nhóm thiết bị trên tab Hardware — khớp cách Proxmox chia màn hình. */
export type HardwareGroup = 'cpu' | 'memory' | 'disk' | 'net' | 'other'

export interface HardwareItem {
  key: string
  group: HardwareGroup
  /** Giá trị thô trên dây (số hoặc property string). */
  value: string
  /** true nếu có form sửa riêng (không phải mục “Khác”). */
  editable: boolean
  /** Có thể xóa qua `delete=<key>` trên PUT config. */
  removable: boolean
  /** Tên schema trong `PVE_PROPERTY_SCHEMAS`, nếu là property string. */
  schemaName?: string
}

const CPU_KEYS = new Set(['cores', 'sockets', 'vcpus', 'cpu', 'cpulimit', 'cpuunits', 'numa', 'affinity'])
const MEMORY_KEYS = new Set(['memory', 'balloon', 'shares', 'swap', 'hugepages'])

const DISK_KEY_RE = /^(scsi|virtio|ide|sata|efidisk|tpmstate)\d+$/
const NET_KEY_RE = /^net\d+$/
const MP_KEY_RE = /^mp\d+$/

/** Ánh xạ tiền tố khóa đĩa QEMU → tên schema property string. */
const DISK_SCHEMA_BY_PREFIX: Record<string, string> = {
  scsi: 'scsi',
  virtio: 'virtio',
  ide: 'ide',
  sata: 'sata',
  efidisk: 'efidisk0',
  tpmstate: 'tpmstate0',
}

/**
 * Tên schema property string cho một khóa config, hoặc `undefined` nếu là scalar /
 * không có schema sinh sẵn.
 */
export function schemaNameForKey(key: string, guestType: 'qemu' | 'lxc'): string | undefined {
  if (NET_KEY_RE.test(key)) return guestType === 'lxc' ? 'lxc.net' : 'qemu.net'
  if (key === 'rootfs') return 'rootfs'
  if (MP_KEY_RE.test(key)) return 'mp'
  const disk = DISK_KEY_RE.exec(key)
  if (disk) {
    const prefix = disk[1]
    return prefix ? DISK_SCHEMA_BY_PREFIX[prefix] : undefined
  }
  return undefined
}

export function propertySchemaForKey(
  key: string,
  guestType: 'qemu' | 'lxc',
): PropertyStringSchema | undefined {
  const name = schemaNameForKey(key, guestType)
  return name ? PVE_PROPERTY_SCHEMAS[name] : undefined
}

function classifyKey(key: string, guestType: 'qemu' | 'lxc'): HardwareGroup {
  if (key === 'digest') return 'other'
  if (CPU_KEYS.has(key)) return 'cpu'
  if (MEMORY_KEYS.has(key)) return 'memory'
  if (NET_KEY_RE.test(key)) return 'net'
  if (guestType === 'lxc' && (key === 'rootfs' || MP_KEY_RE.test(key))) return 'disk'
  if (DISK_KEY_RE.test(key)) return 'disk'
  return 'other'
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * Phân loại object config phẳng của Proxmox thành các mục thiết bị theo nhóm.
 * Bỏ `digest` khỏi danh sách hiển thị (chỉ dùng khi PUT).
 */
export function classifyConfigKeys(
  config: Record<string, unknown>,
  guestType: 'qemu' | 'lxc',
): HardwareItem[] {
  const items: HardwareItem[] = []

  for (const [key, raw] of Object.entries(config)) {
    if (key === 'digest') continue
    const group = classifyKey(key, guestType)
    const schemaName = schemaNameForKey(key, guestType)
    const editable = group === 'cpu' || group === 'memory' || group === 'disk' || group === 'net'
    const removable = group === 'disk' || group === 'net'
    items.push({
      key,
      group,
      value: stringifyValue(raw),
      editable,
      removable: removable && !(guestType === 'lxc' && key === 'rootfs'),
      schemaName,
    })
  }

  const groupOrder: HardwareGroup[] = ['cpu', 'memory', 'disk', 'net', 'other']
  items.sort((a, b) => {
    const g = groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group)
    if (g !== 0) return g
    return a.key.localeCompare(b.key, undefined, { numeric: true })
  })

  return items
}

/** Slot mạng trống tiếp theo: net0, net1, … */
export function nextNetKey(config: Record<string, unknown>): string {
  let i = 0
  while (`net${i}` in config) i += 1
  return `net${i}`
}

/** Slot đĩa trống tiếp theo trên một bus QEMU (scsi/virtio/ide/sata). */
export function nextDiskKey(config: Record<string, unknown>, bus: 'scsi' | 'virtio' | 'ide' | 'sata'): string {
  let i = 0
  while (`${bus}${i}` in config) i += 1
  return `${bus}${i}`
}

/** Slot mount point LXC trống tiếp theo. */
export function nextMpKey(config: Record<string, unknown>): string {
  let i = 0
  while (`mp${i}` in config) i += 1
  return `mp${i}`
}

/** Tóm tắt một dòng để hiện trong bảng — không thay property string đầy đủ. */
export function summarizeHardwareValue(
  item: HardwareItem,
  guestType: 'qemu' | 'lxc',
): string {
  if (item.group === 'cpu' || item.group === 'memory' || item.group === 'other') {
    return item.value
  }

  const schema = propertySchemaForKey(item.key, guestType)
  const parsed = parsePropertyString(item.value, schema)

  if (item.group === 'net') {
    if (guestType === 'lxc') {
      const name = parsed['name'] ?? item.key
      const bridge = parsed['bridge'] ?? '—'
      const ip = parsed['ip'] ?? ''
      return ip ? `${name} → ${bridge} (${ip})` : `${name} → ${bridge}`
    }
    const model = parsed['model'] ?? '?'
    const mac = parsed['macaddr'] ?? ''
    const bridge = parsed['bridge'] ?? '—'
    return mac ? `${model}=${mac}, bridge=${bridge}` : `${model}, bridge=${bridge}`
  }

  // disk
  const file = parsed['file'] ?? parsed['volume'] ?? item.value
  const size = parsed['size']
  const media = parsed['media']
  if (media === 'cdrom') return `CD/DVD: ${file}`
  return size ? `${file} (${size})` : String(file)
}
