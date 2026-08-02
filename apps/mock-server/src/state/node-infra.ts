/**
 * Trạng thái hạ tầng theo node (mạng / DNS / hosts / timezone) — giai đoạn 7.
 *
 * Tách khỏi fixture guest/storage vì thay đổi pending/apply/revert là stateful
 * trong phiên mock, không cần (và không nên) serialize toàn bộ vào JSON seed.
 */

export interface MockIface {
  iface: string
  type: string
  method?: string
  address?: string
  netmask?: string
  gateway?: string
  cidr?: string
  bridge_ports?: string
  bridge_vids?: string
  bridge_vlan_aware?: boolean
  slaves?: string
  bond_mode?: string
  'bond-primary'?: string
  'vlan-id'?: string
  'vlan-raw-device'?: string
  comments?: string
  mtu?: string
  active?: boolean
  autostart?: boolean
  exists?: boolean
  [key: string]: string | boolean | undefined
}

export interface NodeDns {
  search: string
  dns1?: string
  dns2?: string
  dns3?: string
}

export interface NodeInfraState {
  network: MockIface[]
  /** Snapshot đã apply — dùng để revert. */
  committed: MockIface[]
  networkPending: boolean
  dns: NodeDns
  hosts: string
  timezone: string
}

export function cloneIfaces(list: MockIface[]): MockIface[] {
  return list.map((i) => ({ ...i }))
}

/** Seed mặc định: eth0 + vmbr0 — khớp net0 bridge=vmbr0 trên guest fixture. */
export function defaultNodeInfra(node: string, index = 0): NodeInfraState {
  const ip = `192.168.1.${10 + index}`
  const network: MockIface[] = [
    {
      iface: 'lo',
      type: 'loopback',
      method: 'loopback',
      active: true,
      autostart: true,
      exists: true,
    },
    {
      iface: 'eth0',
      type: 'eth',
      method: 'manual',
      active: true,
      autostart: true,
      exists: true,
    },
    {
      iface: 'vmbr0',
      type: 'bridge',
      method: 'static',
      address: ip,
      netmask: '255.255.255.0',
      gateway: '192.168.1.1',
      cidr: `${ip}/24`,
      bridge_ports: 'eth0',
      active: true,
      autostart: true,
      exists: true,
      comments: 'management',
    },
  ]
  return {
    network,
    committed: cloneIfaces(network),
    networkPending: false,
    dns: {
      search: 'lab.local',
      dns1: '192.168.1.1',
      dns2: '1.1.1.1',
    },
    hosts:
      `127.0.0.1 localhost.localdomain localhost\n` +
      `${ip} ${node}.lab.local ${node}\n`,
    timezone: 'Asia/Ho_Chi_Minh',
  }
}
