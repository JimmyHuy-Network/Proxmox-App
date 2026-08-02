/**
 * Trạng thái hạ tầng theo node — giai đoạn 7 (mạng, đĩa, apt, certs, DNS…).
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

export interface MockDisk {
  devpath: string
  size: number
  model?: string
  serial?: string
  vendor?: string
  gpt?: number
  health?: string
  mounted?: number
  used?: string
  osdid?: number
  wiped?: boolean
}

export interface MockDirectory {
  name: string
  path: string
  device: string
  type: string
  options?: string
  unitfile?: string
}

export interface MockLvmVg {
  name: string
  size: number
  free: number
  children?: { name: string; size: number; free?: number }[]
  leaf?: number
}

export interface MockLvmThin {
  lv: string
  vg: string
  lv_size: number
  used: number
  metadata_size?: number
  metadata_used?: number
}

export interface MockZfsPool {
  name: string
  size: number
  alloc: number
  free: number
  health: string
  frag?: number
  dedup?: number
}

export interface MockAptPackage {
  Package: string
  Title?: string
  Version?: string
  OldVersion?: string
  Description?: string
  Origin?: string
  Priority?: string
  Section?: string
}

export interface MockCertInfo {
  filename: string
  fingerprint: string
  issuer: string
  subject: string
  notafter: number
  notbefore: number
  san?: string[]
  pem?: string
}

export interface NodeInfraState {
  network: MockIface[]
  committed: MockIface[]
  networkPending: boolean
  dns: NodeDns
  hosts: string
  timezone: string
  disks: MockDisk[]
  directories: MockDirectory[]
  lvm: MockLvmVg[]
  lvmthin: MockLvmThin[]
  zfs: MockZfsPool[]
  aptUpdates: MockAptPackage[]
  aptVersions: MockAptPackage[]
  certificates: MockCertInfo[]
  acmeEnabled: boolean
}

export function cloneIfaces(list: MockIface[]): MockIface[] {
  return list.map((i) => ({ ...i }))
}

/** Seed mặc định: eth0 + vmbr0 + đĩa/apt/certs cơ bản. */
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

  const now = Math.floor(Date.now() / 1000)

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
    disks: [
      {
        devpath: '/dev/sda',
        size: 500 * 1024 ** 3,
        model: 'SAMSUNG MZVL',
        serial: `SDA${index}ROOT`,
        vendor: 'ATA',
        gpt: 1,
        health: 'PASSED',
        mounted: 1,
        used: 'LVM',
        osdid: -1,
      },
      {
        devpath: '/dev/sdb',
        size: 2 * 1024 ** 4,
        model: 'WDC WD20EZAZ',
        serial: `SDB${index}FREE`,
        vendor: 'ATA',
        gpt: 0,
        health: 'PASSED',
        mounted: 0,
        used: '',
        osdid: -1,
      },
      {
        devpath: '/dev/sdc',
        size: 1 * 1024 ** 4,
        model: 'Crucial CT1000',
        serial: `SDC${index}FREE`,
        vendor: 'ATA',
        gpt: 0,
        health: 'PASSED',
        mounted: 0,
        used: '',
        osdid: -1,
      },
    ],
    directories: [
      {
        name: 'backup',
        path: '/mnt/backup',
        device: '/dev/sdb1',
        type: 'ext4',
        options: 'defaults',
      },
    ],
    lvm: [
      {
        name: 'pve',
        size: 400 * 1024 ** 3,
        free: 50 * 1024 ** 3,
        leaf: 0,
        children: [
          { name: 'root', size: 96 * 1024 ** 3 },
          { name: 'swap', size: 8 * 1024 ** 3 },
          { name: 'data', size: 280 * 1024 ** 3, free: 100 * 1024 ** 3 },
        ],
      },
    ],
    lvmthin: [
      {
        lv: 'data',
        vg: 'pve',
        lv_size: 280 * 1024 ** 3,
        used: 120 * 1024 ** 3,
        metadata_size: 1024 ** 3,
        metadata_used: 64 * 1024 ** 2,
      },
    ],
    zfs: [],
    aptUpdates: [
      {
        Package: 'pve-manager',
        Title: 'Proxmox VE Manager',
        Version: '9.2.2',
        OldVersion: '9.2.1',
        Origin: 'Proxmox',
        Priority: 'optional',
        Section: 'admin',
      },
      {
        Package: 'qemu-server',
        Title: 'QEMU Server',
        Version: '9.2.3',
        OldVersion: '9.2.1',
        Origin: 'Proxmox',
      },
    ],
    aptVersions: [
      { Package: 'proxmox-ve', Version: '9.2.0', Title: 'Proxmox VE' },
      { Package: 'pve-manager', Version: '9.2.1', Title: 'Proxmox VE Manager' },
      { Package: 'qemu-server', Version: '9.2.1', Title: 'QEMU Server' },
    ],
    certificates: [
      {
        filename: 'pveproxy-ssl.pem',
        fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA',
        issuer: `CN=${node}.lab.local`,
        subject: `CN=${node}.lab.local`,
        notbefore: now - 86400 * 30,
        notafter: now + 86400 * 335,
        san: [`DNS:${node}`, `DNS:${node}.lab.local`, `IP:${ip}`],
      },
    ],
    acmeEnabled: false,
  }
}

/** Trạng thái Ceph cụm (dùng chung mọi node). */
export interface MockCephState {
  health: 'HEALTH_OK' | 'HEALTH_WARN' | 'HEALTH_ERR'
  fsid: string
  monmap: { mons: { name: string; rank: number }[] }
  osdmap: { num_osds: number; num_up_osds: number; num_in_osds: number }
  pgmap: { num_pgs: number; bytes_used: number; bytes_total: number }
  pools: { pool: number; pool_name: string; size: number; min_size: number; pg_num: number; bytes_used: number }[]
  osds: { id: number; name: string; host: string; status: string; weight: number }[]
  mons: { name: string; host: string; rank: number; quorum: boolean; state: string }[]
}

export function defaultCephState(nodes: string[], degraded = false): MockCephState {
  const hosts = nodes.length > 0 ? nodes : ['pve1']
  return {
    health: degraded ? 'HEALTH_WARN' : 'HEALTH_OK',
    fsid: '11111111-2222-3333-4444-555555555555',
    monmap: {
      mons: hosts.slice(0, 3).map((n, i) => ({ name: n, rank: i })),
    },
    osdmap: {
      num_osds: hosts.length * 2,
      num_up_osds: degraded ? hosts.length * 2 - 1 : hosts.length * 2,
      num_in_osds: hosts.length * 2,
    },
    pgmap: {
      num_pgs: 128,
      bytes_used: degraded ? 600 * 1024 ** 3 : 400 * 1024 ** 3,
      bytes_total: 2 * 1024 ** 4,
    },
    pools: [
      {
        pool: 1,
        pool_name: 'rbd',
        size: 3,
        min_size: 2,
        pg_num: 64,
        bytes_used: 300 * 1024 ** 3,
      },
      {
        pool: 2,
        pool_name: 'cephfs_data',
        size: 3,
        min_size: 2,
        pg_num: 32,
        bytes_used: 100 * 1024 ** 3,
      },
    ],
    osds: hosts.flatMap((host, hi) => [
      {
        id: hi * 2,
        name: `osd.${hi * 2}`,
        host,
        status: 'up',
        weight: 1,
      },
      {
        id: hi * 2 + 1,
        name: `osd.${hi * 2 + 1}`,
        host,
        status: degraded && hi === hosts.length - 1 ? 'down' : 'up',
        weight: 1,
      },
    ]),
    mons: hosts.slice(0, 3).map((host, i) => ({
      name: host,
      host,
      rank: i,
      quorum: !(degraded && i === 2),
      state: degraded && i === 2 ? 'probing' : 'leader',
    })),
  }
}

export interface MockClusterConfig {
  created: boolean
  clustername: string
  nodes: string[]
  totem?: Record<string, unknown>
}
