/**
 * Trạng thái GĐ 8: Access đầy đủ, Firewall, SDN, HA, replication,
 * notification targets, metric servers — sống trong bộ nhớ như GĐ 7 infra.
 */

export type AclType = 'user' | 'group' | 'token'

export interface MockAcl {
  path: string
  ugid: string
  type: AclType
  roleid: string
  propagate?: number
}

export interface MockGroup {
  groupid: string
  comment?: string
  users?: string
}

export interface MockRole {
  roleid: string
  privs: string
  special?: boolean
}

export interface MockRealm {
  realm: string
  type: string
  comment?: string
  /** LDAP / AD / OIDC extras (optional). */
  [key: string]: unknown
}

export interface MockApiToken {
  userid: string
  tokenid: string
  comment?: string
  privsep?: number
  expire?: number
  secret?: string
}

export interface MockTfaEntry {
  userid: string
  id: string
  type: 'totp' | 'recovery' | 'webauthn' | 'yubico'
  description?: string
  enable?: number
  created?: number
}

export interface MockPool {
  poolid: string
  comment?: string
  members: { type: string; vmid?: number; storage?: string; node?: string; id: string }[]
}

export interface FwRule {
  pos: number
  action: string
  type: 'in' | 'out' | 'group'
  enable?: number
  comment?: string
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  macro?: string
  iface?: string
  log?: string
}

export interface FwAlias {
  name: string
  cidr: string
  comment?: string
}

export interface FwIpset {
  name: string
  comment?: string
  entries: { cidr: string; comment?: string; nomatch?: number }[]
}

export interface FwSecurityGroup {
  group: string
  comment?: string
  rules: FwRule[]
}

export interface FwOptions {
  enable?: number
  policy_in?: string
  policy_out?: string
  log_level_in?: string
  log_level_out?: string
  [key: string]: unknown
}

export interface MockFirewallState {
  cluster: {
    rules: FwRule[]
    aliases: FwAlias[]
    ipsets: FwIpset[]
    groups: FwSecurityGroup[]
    options: FwOptions
  }
  nodes: Record<string, { rules: FwRule[]; options: FwOptions }>
  guests: Record<string, { rules: FwRule[]; aliases: FwAlias[]; ipsets: FwIpset[]; options: FwOptions }>
}

export interface SdnZone {
  zone: string
  type: string
  ipam?: string
  dns?: string
  nodes?: string
  mtu?: number
  pending?: boolean
  state?: string
  [key: string]: unknown
}

export interface SdnVnet {
  vnet: string
  zone: string
  tag?: number
  alias?: string
  type?: string
  [key: string]: unknown
}

export interface SdnSubnet {
  subnet: string
  vnet: string
  gateway?: string
  snat?: number
  type?: string
  [key: string]: unknown
}

export interface SdnController {
  controller: string
  type: string
  [key: string]: unknown
}

export interface SdnIpam {
  ipam: string
  type: string
  [key: string]: unknown
}

export interface HaGroup {
  group: string
  nodes: string
  comment?: string
  restricted?: number
  nofailback?: number
}

export interface HaResource {
  sid: string
  state?: string
  group?: string
  max_restart?: number
  max_relocate?: number
  comment?: string
}

export interface HaRule {
  rule: string
  type: string
  resources?: string
  affinity?: string
  comment?: string
}

export interface ReplicationJob {
  id: string
  guest: number
  target: string
  schedule?: string
  type?: string
  enabled?: number
  comment?: string
  last_sync?: number
  error?: string
}

export interface NotifyTarget {
  name: string
  type: 'sendmail' | 'smtp' | 'gotify' | 'webhook'
  disable?: number
  comment?: string
  [key: string]: unknown
}

export interface NotifyMatcher {
  name: string
  match_severity?: string
  match_field?: string
  target?: string
  comment?: string
  disable?: number
}

export interface MetricServer {
  id: string
  type: string
  server: string
  port?: number
  disable?: number
  path?: string
  proto?: string
}

export interface Phase8State {
  groups: MockGroup[]
  roles: MockRole[]
  realms: MockRealm[]
  tokens: MockApiToken[]
  tfa: MockTfaEntry[]
  pools: MockPool[]
  firewall: MockFirewallState
  sdn: {
    zones: SdnZone[]
    vnets: SdnVnet[]
    subnets: SdnSubnet[]
    controllers: SdnController[]
    ipams: SdnIpam[]
  }
  ha: {
    groups: HaGroup[]
    resources: HaResource[]
    rules: HaRule[]
  }
  replication: ReplicationJob[]
  notifications: {
    targets: NotifyTarget[]
    matchers: NotifyMatcher[]
  }
  metrics: MetricServer[]
}

/** Quyền gắn sẵn theo role (đủ dùng cho mock + UI cap). */
export const BUILTIN_ROLES: MockRole[] = [
  {
    roleid: 'Administrator',
    privs:
      'Permissions.Modify,Sys.Audit,Sys.Console,Sys.Incoming,Sys.Modify,Sys.PowerMgmt,Sys.Syslog,Group.Allocate,User.Modify,Datastore.Allocate,Datastore.AllocateSpace,Datastore.AllocateTemplate,Datastore.Audit,Pool.Allocate,Pool.Audit,SDN.Allocate,SDN.Audit,SDN.Use,VM.Allocate,VM.Audit,VM.Backup,VM.Clone,VM.Config.CDROM,VM.Config.CPU,VM.Config.Cloudinit,VM.Config.Disk,VM.Config.HWType,VM.Config.Memory,VM.Config.Network,VM.Config.Options,VM.Console,VM.Migrate,VM.Monitor,VM.PowerMgmt,VM.Snapshot,VM.Snapshot.Rollback',
    special: true,
  },
  {
    roleid: 'PVEAdmin',
    privs:
      'Sys.Audit,Sys.Console,Sys.Modify,Sys.PowerMgmt,Sys.Syslog,Group.Allocate,User.Modify,Datastore.Allocate,Datastore.AllocateSpace,Datastore.AllocateTemplate,Datastore.Audit,Pool.Allocate,Pool.Audit,SDN.Allocate,SDN.Audit,SDN.Use,VM.Allocate,VM.Audit,VM.Backup,VM.Clone,VM.Config.CDROM,VM.Config.CPU,VM.Config.Cloudinit,VM.Config.Disk,VM.Config.HWType,VM.Config.Memory,VM.Config.Network,VM.Config.Options,VM.Console,VM.Migrate,VM.Monitor,VM.PowerMgmt,VM.Snapshot,VM.Snapshot.Rollback',
    special: true,
  },
  {
    roleid: 'PVEVMAdmin',
    privs:
      'VM.Allocate,VM.Audit,VM.Backup,VM.Clone,VM.Config.CDROM,VM.Config.CPU,VM.Config.Cloudinit,VM.Config.Disk,VM.Config.HWType,VM.Config.Memory,VM.Config.Network,VM.Config.Options,VM.Console,VM.Migrate,VM.Monitor,VM.PowerMgmt,VM.Snapshot,VM.Snapshot.Rollback,SDN.Use',
    special: true,
  },
  {
    roleid: 'PVEVMUser',
    privs:
      'VM.Audit,VM.Backup,VM.Config.CDROM,VM.Config.Cloudinit,VM.Config.Network,VM.Console,VM.PowerMgmt,VM.Snapshot,SDN.Use',
    special: true,
  },
  {
    roleid: 'PVEAuditor',
    privs: 'Sys.Audit,Datastore.Audit,Pool.Audit,SDN.Audit,VM.Audit',
    special: true,
  },
  { roleid: 'NoAccess', privs: '', special: true },
]

export const SEED_ACLS: MockAcl[] = [
  { path: '/', ugid: 'root@pam', type: 'user', roleid: 'Administrator', propagate: 1 },
  { path: '/', ugid: 'operators', type: 'group', roleid: 'PVEAuditor', propagate: 1 },
  { path: '/vms/100', ugid: 'root@pam', type: 'user', roleid: 'PVEVMAdmin', propagate: 1 },
  { path: '/vms/200', ugid: 'root@pam', type: 'user', roleid: 'PVEVMAdmin', propagate: 1 },
]

function defaultFwOptions(): FwOptions {
  return {
    enable: 0,
    policy_in: 'DROP',
    policy_out: 'ACCEPT',
    log_level_in: 'nolog',
    log_level_out: 'nolog',
  }
}

function seedNodeRules(): FwRule[] {
  return [
    {
      pos: 0,
      action: 'ACCEPT',
      type: 'in',
      enable: 1,
      proto: 'tcp',
      dport: '22',
      comment: 'SSH node',
    },
  ]
}

export function defaultPhase8State(nodes: string[], poolsFromFixture: { poolid: string; comment?: string }[]): Phase8State {
  const nodeRules: MockFirewallState['nodes'] = {}
  for (const n of nodes) {
    nodeRules[n] = { rules: seedNodeRules(), options: defaultFwOptions() }
  }

  return {
    groups: [
      { groupid: 'operators', comment: 'Vận hành — quyền audit', users: 'vanhanh@pve' },
      { groupid: 'admins', comment: 'Quản trị', users: 'root@pam' },
    ],
    roles: structuredClone(BUILTIN_ROLES),
    realms: [
      { realm: 'pam', type: 'pam', comment: 'Linux PAM standard authentication' },
      { realm: 'pve', type: 'pve', comment: 'Proxmox VE authentication server' },
      {
        realm: 'ldap',
        type: 'ldap',
        comment: 'LDAP lab',
        server1: 'ldap.lab.local',
        base_dn: 'dc=lab,dc=local',
        user_attr: 'uid',
      },
      {
        realm: 'ad',
        type: 'ad',
        comment: 'Active Directory lab',
        domain: 'LAB.LOCAL',
        server1: 'dc.lab.local',
      },
      {
        realm: 'oidc',
        type: 'openid',
        comment: 'OIDC lab',
        issuer_url: 'https://sso.lab.local',
        client_id: 'pve',
      },
    ],
    tokens: [
      {
        userid: 'root@pam',
        tokenid: 'automation',
        comment: 'CI / automation',
        privsep: 1,
        secret: '00000000-1111-2222-3333-444444444444',
      },
    ],
    tfa: [
      {
        userid: 'tfa@pve',
        id: 'totp-1',
        type: 'totp',
        description: 'Authenticator app',
        enable: 1,
        created: Math.floor(Date.now() / 1000) - 86_400,
      },
    ],
    pools: poolsFromFixture.map((p) => ({
      poolid: p.poolid,
      comment: p.comment,
      members: [],
    })),
    firewall: {
      cluster: {
        rules: [
          {
            pos: 0,
            action: 'ACCEPT',
            type: 'in',
            enable: 1,
            proto: 'tcp',
            dport: '8006',
            comment: 'PVE API',
          },
          {
            pos: 1,
            action: 'ACCEPT',
            type: 'in',
            enable: 1,
            proto: 'tcp',
            dport: '22',
            comment: 'SSH',
          },
        ],
        aliases: [
          { name: 'lan', cidr: '192.168.1.0/24', comment: 'LAN lab' },
          { name: 'mgmt', cidr: '10.0.0.0/8', comment: 'Management' },
        ],
        ipsets: [
          {
            name: 'blacklist',
            comment: 'Blocked sources',
            entries: [{ cidr: '203.0.113.0/24', comment: 'TEST-NET-3' }],
          },
        ],
        groups: [
          {
            group: 'web-server',
            comment: 'HTTP/HTTPS',
            rules: [
              {
                pos: 0,
                action: 'ACCEPT',
                type: 'in',
                enable: 1,
                proto: 'tcp',
                dport: '80,443',
                comment: 'Web',
              },
            ],
          },
        ],
        options: { ...defaultFwOptions(), enable: 1 },
      },
      nodes: nodeRules,
      guests: {
        '100': {
          rules: [
            {
              pos: 0,
              action: 'ACCEPT',
              type: 'in',
              enable: 1,
              proto: 'tcp',
              dport: '22',
              comment: 'SSH guest',
            },
          ],
          aliases: [],
          ipsets: [],
          options: { ...defaultFwOptions(), enable: 1 },
        },
        '200': {
          rules: [
            {
              pos: 0,
              action: 'ACCEPT',
              type: 'in',
              enable: 1,
              proto: 'tcp',
              dport: '22',
              comment: 'SSH CT',
            },
          ],
          aliases: [],
          ipsets: [],
          options: { ...defaultFwOptions(), enable: 1 },
        },
      },
    },
    sdn: {
      zones: [
        { zone: 'localzone', type: 'simple', mtu: 1500, ipam: 'pve', state: 'available' },
        { zone: 'vxlan0', type: 'vxlan', peers: '192.168.1.11,192.168.1.12', mtu: 1450, state: 'available' },
      ],
      vnets: [
        { vnet: 'vnet0', zone: 'localzone', alias: 'lab', type: 'vnet' },
        { vnet: 'vnet1', zone: 'vxlan0', tag: 100, type: 'vnet' },
      ],
      subnets: [
        { subnet: 'localzone/192.168.50.0/24', vnet: 'vnet0', gateway: '192.168.50.1', type: 'subnet' },
      ],
      controllers: [{ controller: 'evpn1', type: 'evpn', asn: 65000 }],
      ipams: [{ ipam: 'pve', type: 'pve' }],
    },
    ha: {
      groups: [
        {
          group: 'ha-preferred',
          nodes: nodes.map((n, i) => `${n}:${nodes.length - i}`).join(','),
          comment: 'Ưu tiên node đầu',
          restricted: 0,
        },
      ],
      resources: [{ sid: 'vm:100', state: 'started', group: 'ha-preferred', max_restart: 1, max_relocate: 1 }],
      rules: [],
    },
    replication: [
      {
        id: '100-0',
        guest: 100,
        target: nodes[1] ?? nodes[0] ?? 'pve2',
        schedule: '*/15',
        type: 'local',
        enabled: 1,
        comment: 'ZFS replicate web-frontend',
        last_sync: Math.floor(Date.now() / 1000) - 600,
      },
    ],
    notifications: {
      targets: [
        {
          name: 'mail-admins',
          type: 'sendmail',
          mailto: 'ops@lab.local',
          comment: 'Gửi mail nội bộ',
        },
        {
          name: 'gotify-lab',
          type: 'gotify',
          server: 'https://gotify.lab.local',
          comment: 'Gotify',
        },
        {
          name: 'smtp-lab',
          type: 'smtp',
          server: 'smtp.lab.local',
          from_address: 'pve@lab.local',
          comment: 'SMTP',
        },
        {
          name: 'webhook-lab',
          type: 'webhook',
          url: 'https://hooks.lab.local/pve',
          comment: 'Webhook',
        },
      ],
      matchers: [
        {
          name: 'errors',
          match_severity: 'error',
          target: 'mail-admins',
          comment: 'Báo lỗi',
        },
      ],
    },
    metrics: [
      {
        id: 'influx',
        type: 'influxdb',
        server: 'influx.lab.local',
        port: 8089,
        proto: 'udp',
        path: '/api/v2/write',
      },
    ],
  }
}

/** Priv list của role. */
export function privsOfRole(roles: MockRole[], roleid: string): Set<string> {
  const role = roles.find((r) => r.roleid === roleid)
  if (!role || !role.privs) return new Set()
  return new Set(role.privs.split(',').map((p) => p.trim()).filter(Boolean))
}

/**
 * Tính quyền hiệu lực cho user theo ACL + membership group.
 * Đơn giản hoá: ACL path khớp exact hoặc là prefix (khi propagate).
 */
export function computeEffectivePrivs(
  acls: MockAcl[],
  roles: MockRole[],
  userid: string,
  path: string,
  userGroups: string[],
): Set<string> {
  const privs = new Set<string>()
  const groupSet = new Set(userGroups)

  for (const acl of acls) {
    const matchesUgid =
      (acl.type === 'user' && acl.ugid === userid) ||
      (acl.type === 'group' && groupSet.has(acl.ugid.replace(/^@/, '')))
    if (!matchesUgid) continue

    const propagate = acl.propagate !== 0
    const exact = acl.path === path
    const under =
      propagate &&
      (acl.path === '/' || path === acl.path || path.startsWith(`${acl.path}/`))
    if (!exact && !under) continue

    for (const p of privsOfRole(roles, acl.roleid)) privs.add(p)
  }

  if (userid === 'root@pam') {
    for (const p of privsOfRole(roles, 'Administrator')) privs.add(p)
  }

  return privs
}

/** Cap object kiểu ticket Proxmox: nhóm theo domain. */
export function capsFromPrivs(privs: Set<string>): Record<string, Record<string, number>> {
  const domains: Record<string, string[]> = {
    access: ['Permissions.Modify', 'User.Modify', 'Group.Allocate'],
    dc: ['Sys.Audit', 'Sys.Modify', 'SDN.Allocate', 'SDN.Audit', 'Pool.Allocate', 'Pool.Audit'],
    nodes: ['Sys.Audit', 'Sys.Console', 'Sys.Modify', 'Sys.PowerMgmt', 'Sys.Syslog', 'Sys.Incoming'],
    vms: [
      'VM.Allocate',
      'VM.Audit',
      'VM.Backup',
      'VM.Clone',
      'VM.Config.CDROM',
      'VM.Config.CPU',
      'VM.Config.Cloudinit',
      'VM.Config.Disk',
      'VM.Config.HWType',
      'VM.Config.Memory',
      'VM.Config.Network',
      'VM.Config.Options',
      'VM.Console',
      'VM.Migrate',
      'VM.Monitor',
      'VM.PowerMgmt',
      'VM.Snapshot',
      'VM.Snapshot.Rollback',
    ],
    storage: ['Datastore.Allocate', 'Datastore.AllocateSpace', 'Datastore.AllocateTemplate', 'Datastore.Audit'],
    sdn: ['SDN.Allocate', 'SDN.Audit', 'SDN.Use'],
  }

  const out: Record<string, Record<string, number>> = {}
  for (const [domain, list] of Object.entries(domains)) {
    const map: Record<string, number> = {}
    for (const p of list) {
      if (privs.has(p)) map[p] = 1
    }
    if (Object.keys(map).length > 0) out[domain] = map
  }
  return out
}
