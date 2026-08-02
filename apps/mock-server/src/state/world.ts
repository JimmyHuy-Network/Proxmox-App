export type GuestType = 'qemu' | 'lxc'
export type RunState = 'running' | 'stopped' | 'paused'

export interface MockNode {
  node: string
  status: 'online' | 'offline'
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  uptime: number
  level: string
}

export interface MockGuest {
  vmid: number
  name: string
  type: GuestType
  node: string
  status: RunState
  cpu: number
  cpus: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  uptime: number
  template: boolean
  tags?: string
  /** Cấu hình thật, giữ nguyên dạng property string như Proxmox trả về. */
  config: Record<string, string | number>
  snapshots: MockSnapshot[]
  /** Khoá đang giữ guest, ví dụ `backup`, `migrate`. */
  lock?: string
}

export interface MockSnapshot {
  name: string
  description: string
  snaptime: number
  vmstate: boolean
  parent?: string
}

export interface MockStorage {
  storage: string
  type: string
  content: string
  nodes?: string
  shared: boolean
  enabled: boolean
  total: number
  used: number
  avail: number
  contents: MockVolume[]
}

export interface MockVolume {
  volid: string
  format: string
  size: number
  content: string
  vmid?: number
  ctime: number
  notes?: string
}

export interface MockUser {
  userid: string
  enable: boolean
  comment?: string
  groups?: string
  realm: string
}

export interface MockWorld {
  clusterName: string
  quorate: boolean
  version: { version: string; release: string; repoid: string }
  nodes: MockNode[]
  guests: MockGuest[]
  storages: MockStorage[]
  users: MockUser[]
  pools: { poolid: string; comment?: string }[]
}

/**
 * Trạng thái của máy chủ giả lập.
 *
 * Cố ý giữ trong bộ nhớ và nạp từ fixture JSON thay vì dùng cơ sở dữ liệu: muốn
 * `reset` diễn ra tức thì, và muốn các kịch bản đọc được bằng mắt khi xem diff git.
 */
export class World {
  private state: MockWorld
  private readonly initial: string

  constructor(initial: MockWorld) {
    this.initial = JSON.stringify(initial)
    this.state = JSON.parse(this.initial) as MockWorld
  }

  get current(): MockWorld {
    return this.state
  }

  reset(): void {
    this.state = JSON.parse(this.initial) as MockWorld
  }

  load(next: MockWorld): void {
    this.state = JSON.parse(JSON.stringify(next)) as MockWorld
  }

  node(name: string): MockNode | undefined {
    return this.state.nodes.find((n) => n.node === name)
  }

  guest(vmid: number): MockGuest | undefined {
    return this.state.guests.find((g) => g.vmid === vmid)
  }

  guestOn(node: string, vmid: number, type: GuestType): MockGuest | undefined {
    return this.state.guests.find((g) => g.vmid === vmid && g.node === node && g.type === type)
  }

  /** Thêm guest mới (wizard tạo VM/CT). Ném nếu vmid đã tồn tại. */
  addGuest(guest: MockGuest): void {
    if (this.state.guests.some((g) => g.vmid === guest.vmid)) {
      throw new Error(`VM ${guest.vmid} already exists`)
    }
    this.state.guests.push(guest)
  }

  /** Xóa guest theo vmid (destroy VM/CT). */
  removeGuest(vmid: number): boolean {
    const before = this.state.guests.length
    this.state.guests = this.state.guests.filter((g) => g.vmid !== vmid)
    return this.state.guests.length < before
  }

  storage(name: string): MockStorage | undefined {
    return this.state.storages.find((s) => s.storage === name)
  }

  /** Dạng tổng hợp mà `/cluster/resources` trả về — nền tảng của cây tài nguyên. */
  clusterResources(): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = []

    for (const node of this.state.nodes) {
      rows.push({
        id: `node/${node.node}`,
        type: 'node',
        node: node.node,
        status: node.status,
        cpu: node.cpu,
        maxcpu: node.maxcpu,
        mem: node.mem,
        maxmem: node.maxmem,
        disk: node.disk,
        maxdisk: node.maxdisk,
        uptime: node.uptime,
        level: node.level,
      })
    }

    for (const guest of this.state.guests) {
      rows.push({
        id: `${guest.type}/${guest.vmid}`,
        type: guest.type,
        vmid: guest.vmid,
        name: guest.name,
        node: guest.node,
        status: guest.status,
        cpu: guest.status === 'running' ? guest.cpu : 0,
        maxcpu: guest.cpus,
        mem: guest.status === 'running' ? guest.mem : 0,
        maxmem: guest.maxmem,
        disk: guest.disk,
        maxdisk: guest.maxdisk,
        uptime: guest.status === 'running' ? guest.uptime : 0,
        template: guest.template ? 1 : 0,
        ...(guest.tags ? { tags: guest.tags } : {}),
        ...(guest.lock ? { lock: guest.lock } : {}),
      })
    }

    for (const storage of this.state.storages) {
      for (const node of storage.shared ? [this.state.nodes[0]?.node] : this.nodesFor(storage)) {
        if (!node) continue
        rows.push({
          id: `storage/${node}/${storage.storage}`,
          type: 'storage',
          storage: storage.storage,
          node,
          status: storage.enabled ? 'available' : 'disabled',
          plugintype: storage.type,
          content: storage.content,
          shared: storage.shared ? 1 : 0,
          disk: storage.used,
          maxdisk: storage.total,
        })
      }
    }

    return rows
  }

  private nodesFor(storage: MockStorage): string[] {
    if (storage.nodes) return storage.nodes.split(',')
    return this.state.nodes.map((n) => n.node)
  }
}
