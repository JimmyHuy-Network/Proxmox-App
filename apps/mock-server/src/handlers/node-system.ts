import { HttpError, type HandlerTable, type MockHandler } from '../router.ts'
import { templateFor } from '../tasks/engine.ts'
import type { MockContext } from '../context.ts'

/**
 * Disks / SMART / LVM / ZFS / directory + apt + certificates + syslog/journal (GĐ 7).
 */

function str(value: unknown): string {
  return String(value ?? '')
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function requireNode(mock: MockContext, name: string): void {
  if (!mock.world.node(name)) throw new HttpError(500, `node '${name}' does not exist`)
}

function infra(mock: MockContext, node: string) {
  requireNode(mock, node)
  return mock.ensureNodeInfra(node)
}

function runTask(
  mock: MockContext,
  init: { node: string; type: string; id: string; user: string; onSuccess?: () => void },
): string {
  return mock.tasks.startTask({ ...init, steps: templateFor(init.type) }).upid
}

function register(on: (m: 'GET' | 'POST' | 'PUT' | 'DELETE', p: string, h: MockHandler) => void): void {
  // ── Disks ──────────────────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/disks', ({ input, mock }) => {
    requireNode(mock, str(input['node']))
    return [
      { name: 'list' },
      { name: 'smart' },
      { name: 'directory' },
      { name: 'lvm' },
      { name: 'lvmthin' },
      { name: 'zfs' },
    ]
  })

  on('GET', '/nodes/{node}/disks/list', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    return state.disks.map((d) => ({
      devpath: d.devpath,
      size: d.size,
      model: d.model,
      serial: d.serial,
      vendor: d.vendor,
      gpt: d.gpt ?? 0,
      health: d.health ?? 'UNKNOWN',
      mounted: d.mounted ?? 0,
      used: d.used ?? '',
      osdid: d.osdid ?? -1,
    }))
  })

  on('GET', '/nodes/{node}/disks/smart', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    const disk = str(input['disk'])
    const found = state.disks.find((d) => d.devpath === disk || d.devpath.endsWith(disk))
    const health = found?.health ?? 'PASSED'
    if (truthy(input['healthonly'])) return { health }
    return {
      health,
      type: 'ATA',
      text: `SMART overall-health self-assessment test result: ${health}`,
      attributes: [
        { id: 5, name: 'Reallocated_Sector_Ct', value: 100, worst: 0, threshold: 10 },
        { id: 9, name: 'Power_On_Hours', value: 99, raw: '12345' },
        { id: 194, name: 'Temperature_Celsius', value: 45, raw: '45' },
      ],
    }
  })

  on('POST', '/nodes/{node}/disks/initgpt', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const disk = str(input['disk'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'diskinit',
      id: disk,
      user: auth.username,
      onSuccess: () => {
        const d = state.disks.find((x) => x.devpath === disk || x.devpath.endsWith(disk))
        if (d) d.gpt = 1
      },
    })
  })

  on('PUT', '/nodes/{node}/disks/wipedisk', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const disk = str(input['disk'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'diskwipe',
      id: disk,
      user: auth.username,
      onSuccess: () => {
        const d = state.disks.find((x) => x.devpath === disk || x.devpath.endsWith(disk))
        if (d) {
          d.wiped = true
          d.gpt = 0
          d.used = ''
          d.mounted = 0
        }
      },
    })
  })

  on('GET', '/nodes/{node}/disks/directory', ({ input, mock }) => {
    return infra(mock, str(input['node'])).directories.map((d) => ({
      path: d.path,
      device: d.device,
      type: d.type,
      options: d.options ?? 'defaults',
      unitfile: d.unitfile ?? `mnt-${d.name}.mount`,
    }))
  })

  on('POST', '/nodes/{node}/disks/directory', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const device = str(input['device'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'dircreate',
      id: name,
      user: auth.username,
      onSuccess: () => {
        state.directories.push({
          name,
          path: `/mnt/${name}`,
          device,
          type: str(input['filesystem'] || 'ext4'),
          options: 'defaults',
        })
        const disk = state.disks.find((d) => d.devpath === device)
        if (disk) {
          disk.used = 'ext4'
          disk.mounted = 1
          disk.gpt = 1
        }
      },
    })
  })

  on('DELETE', '/nodes/{node}/disks/directory/{name}', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'dirremove',
      id: name,
      user: auth.username,
      onSuccess: () => {
        state.directories = state.directories.filter((d) => d.name !== name)
      },
    })
  })

  on('GET', '/nodes/{node}/disks/lvm', ({ input, mock }) => {
    const vgs = infra(mock, str(input['node'])).lvm
    return {
      leaf: 0,
      children: vgs.map((vg) => ({
        name: vg.name,
        size: vg.size,
        free: vg.free,
        leaf: 0,
        children: (vg.children ?? []).map((c) => ({
          name: c.name,
          size: c.size,
          free: c.free,
          leaf: 1,
        })),
      })),
    }
  })

  on('POST', '/nodes/{node}/disks/lvm', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const device = str(input['device'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'lvmcreate',
      id: name,
      user: auth.username,
      onSuccess: () => {
        const disk = state.disks.find((d) => d.devpath === device)
        state.lvm.push({
          name,
          size: disk?.size ?? 100 * 1024 ** 3,
          free: disk?.size ?? 100 * 1024 ** 3,
          leaf: 0,
          children: [],
        })
        if (disk) {
          disk.used = 'LVM'
          disk.gpt = 1
        }
      },
    })
  })

  on('DELETE', '/nodes/{node}/disks/lvm/{name}', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'lvmremove',
      id: name,
      user: auth.username,
      onSuccess: () => {
        state.lvm = state.lvm.filter((v) => v.name !== name)
      },
    })
  })

  on('GET', '/nodes/{node}/disks/lvmthin', ({ input, mock }) => {
    return infra(mock, str(input['node'])).lvmthin
  })

  on('POST', '/nodes/{node}/disks/lvmthin', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const device = str(input['device'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'lvmthincreate',
      id: name,
      user: auth.username,
      onSuccess: () => {
        const disk = state.disks.find((d) => d.devpath === device)
        state.lvmthin.push({
          lv: name,
          vg: 'pve',
          lv_size: disk?.size ?? 100 * 1024 ** 3,
          used: 0,
        })
      },
    })
  })

  on('DELETE', '/nodes/{node}/disks/lvmthin/{name}', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'lvmthinremove',
      id: name,
      user: auth.username,
      onSuccess: () => {
        state.lvmthin = state.lvmthin.filter((t) => t.lv !== name)
      },
    })
  })

  on('GET', '/nodes/{node}/disks/zfs', ({ input, mock }) => {
    return infra(mock, str(input['node'])).zfs
  })

  on('POST', '/nodes/{node}/disks/zfs', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const devices = str(input['devices'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'zfscreate',
      id: name,
      user: auth.username,
      onSuccess: () => {
        const size = devices
          .split(/[\s,]+/)
          .filter(Boolean)
          .reduce((sum, dev) => {
            const d = state.disks.find((x) => x.devpath === dev || x.devpath.endsWith(dev))
            return sum + (d?.size ?? 100 * 1024 ** 3)
          }, 0)
        state.zfs.push({
          name,
          size,
          alloc: 0,
          free: size,
          health: 'ONLINE',
          frag: 0,
          dedup: 1,
        })
        for (const dev of devices.split(/[\s,]+/).filter(Boolean)) {
          const d = state.disks.find((x) => x.devpath === dev || x.devpath.endsWith(dev))
          if (d) {
            d.used = 'ZFS'
            d.gpt = 1
          }
        }
      },
    })
  })

  on('GET', '/nodes/{node}/disks/zfs/{name}', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    const name = str(input['name'])
    const pool = state.zfs.find((z) => z.name === name)
    if (!pool) {
      return { name, size: 0, alloc: 0, free: 0, health: 'ONLINE', children: [] }
    }
    return { ...pool, children: [] }
  })

  on('DELETE', '/nodes/{node}/disks/zfs/{name}', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'zfsremove',
      id: name,
      user: auth.username,
      onSuccess: () => {
        state.zfs = state.zfs.filter((z) => z.name !== name)
      },
    })
  })

  // ── Apt ────────────────────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/apt', ({ input, mock }) => {
    requireNode(mock, str(input['node']))
    return [{ id: 'update' }, { id: 'versions' }, { id: 'changelog' }, { id: 'repositories' }]
  })

  on('GET', '/nodes/{node}/apt/update', ({ input, mock }) => {
    return infra(mock, str(input['node'])).aptUpdates
  })

  on('POST', '/nodes/{node}/apt/update', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'aptupdate',
      id: node,
      user: auth.username,
      onSuccess: () => {
        // Sau apt update: coi như đã làm mới danh sách (giữ nguyên để UI vẫn có gì để xem).
        void state
      },
    })
  })

  on('GET', '/nodes/{node}/apt/versions', ({ input, mock }) => {
    return infra(mock, str(input['node'])).aptVersions
  })

  on('GET', '/nodes/{node}/apt/changelog', ({ input, mock }) => {
    requireNode(mock, str(input['node']))
    const name = str(input['name'])
    return `${name} (mock changelog)\n\n  * Mock entry for lab testing\n`
  })

  on('GET', '/nodes/{node}/apt/repositories', ({ input, mock }) => {
    requireNode(mock, str(input['node']))
    return {
      digest: 'mockaptdigest01',
      errors: [],
      infos: [],
      files: [
        {
          path: '/etc/apt/sources.list',
          repositories: [
            {
              Types: ['deb'],
              URIs: ['http://deb.debian.org/debian'],
              Suites: ['trixie'],
              Components: ['main', 'contrib'],
              Enabled: true,
            },
          ],
        },
        {
          path: '/etc/apt/sources.list.d/pve-enterprise.list',
          repositories: [
            {
              Types: ['deb'],
              URIs: ['https://enterprise.proxmox.com/debian/pve'],
              Suites: ['trixie'],
              Components: ['pve-enterprise'],
              Enabled: false,
            },
          ],
        },
      ],
      'standard-repos': [
        { handle: 'no-subscription', name: 'Proxmox VE No-Subscription', status: false },
        { handle: 'enterprise', name: 'Proxmox VE Enterprise', status: false },
        { handle: 'test', name: 'Proxmox VE Test', status: false },
      ],
    }
  })

  on('POST', '/nodes/{node}/apt/repositories', () => null)
  on('PUT', '/nodes/{node}/apt/repositories', () => null)

  // ── Certificates ───────────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/certificates', ({ input, mock }) => {
    requireNode(mock, str(input['node']))
    return [{ name: 'info' }, { name: 'acme' }, { name: 'custom' }]
  })

  on('GET', '/nodes/{node}/certificates/info', ({ input, mock }) => {
    return infra(mock, str(input['node'])).certificates
  })

  on('POST', '/nodes/{node}/certificates/custom', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    const now = Math.floor(Date.now() / 1000)
    const cert = {
      filename: 'pveproxy-ssl.pem',
      fingerprint: '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
      issuer: 'CN=custom-lab',
      subject: 'CN=custom-lab',
      notbefore: now,
      notafter: now + 86400 * 365,
      pem: str(input['certificates']).slice(0, 120),
    }
    state.certificates = [cert]
    return cert
  })

  on('DELETE', '/nodes/{node}/certificates/custom', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    state.certificates = state.certificates.filter((c) => c.filename !== 'pveproxy-ssl.pem')
    return null
  })

  on('POST', '/nodes/{node}/certificates/acme/certificate', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'acmeorder',
      id: node,
      user: auth.username,
      onSuccess: () => {
        state.acmeEnabled = true
        const now = Math.floor(Date.now() / 1000)
        state.certificates = [
          {
            filename: 'pveproxy-ssl.pem',
            fingerprint: 'AC:ME:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC',
            issuer: "CN=Let's Encrypt Mock",
            subject: `CN=${node}.lab.local`,
            notbefore: now,
            notafter: now + 86400 * 90,
            san: [`DNS:${node}.lab.local`],
          },
        ]
      },
    })
  })

  on('PUT', '/nodes/{node}/certificates/acme/certificate', ({ input, mock, auth }) => {
    const node = str(input['node'])
    return runTask(mock, {
      node,
      type: 'acmerenew',
      id: node,
      user: auth.username,
    })
  })

  on('DELETE', '/nodes/{node}/certificates/acme/certificate', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'acmerevoke',
      id: node,
      user: auth.username,
      onSuccess: () => {
        state.acmeEnabled = false
      },
    })
  })

  // Cluster ACME stubs (đủ cho UI list)
  on('GET', '/cluster/acme', () => [{ name: 'account' }, { name: 'plugins' }, { name: 'directories' }, { name: 'tos' }])
  on('GET', '/cluster/acme/account', () => [{ name: 'default', directory: 'https://acme-v02.api.letsencrypt.org/directory' }])
  on('GET', '/cluster/acme/directories', () => [
    { name: "Let's Encrypt V2", url: 'https://acme-v02.api.letsencrypt.org/directory' },
    { name: "Let's Encrypt V2 Staging", url: 'https://acme-staging-v02.api.letsencrypt.org/directory' },
  ])
  on('GET', '/cluster/acme/tos', () => 'https://letsencrypt.org/documents/LE-SA-v1.3-September-21-2022.pdf')
  on('GET', '/cluster/acme/plugins', () => [])
  on('POST', '/cluster/acme/account', ({ input, mock, auth }) =>
    runTask(mock, {
      node: mock.world.current.nodes[0]?.node ?? 'pve1',
      type: 'acmeaccount',
      id: str(input['name'] || 'default'),
      user: auth.username,
    }),
  )

  // ── Syslog / journal ───────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/syslog', ({ input, mock }) => {
    const node = str(input['node'])
    requireNode(mock, node)
    const start = Number(input['start'] ?? 0) || 0
    const limit = Math.min(Number(input['limit'] ?? 50) || 50, 500)
    const rows = []
    for (let i = 0; i < limit; i++) {
      const n = start + i + 1
      rows.push({
        n,
        t: `${new Date(Date.now() - (limit - i) * 1000).toISOString().slice(11, 19)} ${node} pvedaemon[1${n}]: mock syslog line ${n}`,
      })
    }
    return rows
  })

  on('GET', '/nodes/{node}/journal', ({ input, mock }) => {
    const node = str(input['node'])
    requireNode(mock, node)
    const last = Math.min(Number(input['lastentries'] ?? 40) || 40, 200)
    const lines: string[] = []
    for (let i = 0; i < last; i++) {
      lines.push(
        JSON.stringify({
          __REALTIME_TIMESTAMP: String((Date.now() - (last - i) * 1000) * 1000),
          PRIORITY: String(i % 11 === 0 ? 3 : 6),
          SYSLOG_IDENTIFIER: i % 2 === 0 ? 'pvedaemon' : 'pveproxy',
          MESSAGE: `mock journal ${i + 1} on ${node}`,
        }),
      )
    }
    return lines
  })
}

export function applyNodeSystemHandlers(handlers: HandlerTable): void {
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[`${method} ${path}`] = handler
  }
  register(on)
}
