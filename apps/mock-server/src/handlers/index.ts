import { HttpError, handlerKey, type HandlerTable, type MockHandler } from '../router.ts'
import { TFA_CODE, type AuthStore } from '../auth.ts'
import { failingVariant, templateFor } from '../tasks/engine.ts'
import { synthRrd } from '../rrd.ts'
import type { MockContext } from '../context.ts'
import type { GuestType, MockGuest, MockSnapshot } from '../state/world.ts'

/**
 * Hành vi thật cho những endpoint quan trọng nhất.
 *
 * Endpoint nào chưa có ở đây vẫn trả lời được nhờ bộ sinh tự động theo `returns`,
 * nên giao diện dựng được trước rồi bổ sung hành vi sau — đúng thứ tự các giai đoạn
 * trong kế hoạch.
 */

function requireGuest(mock: MockContext, node: string, vmid: number, type: GuestType): MockGuest {
  const guest = mock.world.guestOn(node, vmid, type)
  if (!guest) {
    throw new HttpError(500, `Configuration file 'nodes/${node}/${type}-server/${vmid}.conf' does not exist`)
  }
  return guest
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

/** Khởi một tác vụ chạy nền và trả về UPID, đúng như Proxmox thật. */
function runTask(
  mock: MockContext,
  init: { node: string; type: string; id: string; user: string; onSuccess?: () => void },
): string {
  const steps = templateFor(init.type)
  return mock.tasks.startTask({ ...init, steps }).upid
}

export function buildHandlers(authStore: AuthStore): HandlerTable {
  const handlers: HandlerTable = {}
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[handlerKey(method, path)] = handler
  }

  // ── Xác thực ───────────────────────────────────────────────────────────────

  on('POST', '/access/ticket', ({ input }) => {
    const username = String(input['username'] ?? '')
    const password = String(input['password'] ?? '')
    const challenge = input['tfa-challenge']

    const result = authStore.login(
      username,
      password,
      typeof challenge === 'string' ? challenge : undefined,
    )

    if (result.status === 'failed') {
      throw new HttpError(401, 'authentication failure')
    }

    if (result.status === 'tfa') {
      // Proxmox trả về vé tạm kèm cờ NeedTFA; client phải đổi nó lấy vé thật.
      return {
        ticket: result.partialTicket,
        username,
        NeedTFA: 1,
        // Gợi ý cho người dùng khi phát triển; máy chủ thật dĩ nhiên không làm vậy.
        __hint: `Mã OTP giả lập là ${TFA_CODE}`,
      }
    }

    return {
      ticket: result.ticket.ticket,
      CSRFPreventionToken: result.ticket.csrfToken,
      username: result.ticket.username,
      clustername: 'pve-lab',
      cap: { vms: { 'VM.Console': 1, 'VM.PowerMgmt': 1 }, nodes: { 'Sys.Audit': 1 } },
    }
  })

  on('GET', '/access/domains', () => [
    { realm: 'pam', type: 'pam', comment: 'Linux PAM standard authentication' },
    { realm: 'pve', type: 'pve', comment: 'Proxmox VE authentication server' },
  ])

  on('GET', '/access/users', ({ mock }) =>
    mock.world.current.users.map((u) => ({
      userid: u.userid,
      enable: u.enable ? 1 : 0,
      realm_type: u.realm,
      ...(u.comment ? { comment: u.comment } : {}),
      ...(u.groups ? { groups: u.groups } : {}),
    })),
  )

  // ── Cụm ────────────────────────────────────────────────────────────────────

  on('GET', '/version', ({ mock }) => {
    const v = mock.world.current.version
    return { version: v.version, release: v.release, repoid: v.repoid, console: 'xtermjs' }
  })

  on('GET', '/cluster/resources', ({ mock, input }) => {
    const rows = mock.world.clusterResources()
    const type = input['type']
    // Proxmox: `type=vm` gồm cả qemu và lxc (không phải một type riêng).
    if (typeof type !== 'string') return rows
    if (type === 'vm') return rows.filter((r) => r['type'] === 'qemu' || r['type'] === 'lxc')
    return rows.filter((r) => r['type'] === type)
  })

  on('GET', '/cluster/status', ({ mock }) => {
    const world = mock.world.current
    return [
      {
        id: 'cluster',
        type: 'cluster',
        name: world.clusterName,
        version: world.nodes.length,
        nodes: world.nodes.length,
        quorate: world.quorate ? 1 : 0,
      },
      ...world.nodes.map((n, index) => ({
        id: `node/${n.node}`,
        type: 'node',
        name: n.node,
        nodeid: index + 1,
        online: n.status === 'online' ? 1 : 0,
        local: index === 0 ? 1 : 0,
        ip: `192.168.1.${10 + index}`,
      })),
    ]
  })

  on('GET', '/cluster/nextid', ({ mock }) => {
    const used = new Set(mock.world.current.guests.map((g) => g.vmid))
    let id = 100
    while (used.has(id)) id += 1
    return String(id)
  })

  on('GET', '/cluster/tasks', ({ mock }) => mock.tasks.list().map(taskSummary))

  on('GET', '/pools', ({ mock }) => mock.world.current.pools)

  // ── Node ───────────────────────────────────────────────────────────────────

  on('GET', '/nodes', ({ mock }) =>
    mock.world.current.nodes.map((n) => ({
      node: n.node,
      status: n.status,
      cpu: n.cpu,
      maxcpu: n.maxcpu,
      mem: n.mem,
      maxmem: n.maxmem,
      disk: n.disk,
      maxdisk: n.maxdisk,
      uptime: n.uptime,
      level: n.level,
      type: 'node',
      id: `node/${n.node}`,
      ssl_fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    })),
  )

  on('GET', '/nodes/{node}/status', ({ input, mock }) => {
    const node = mock.world.node(String(input['node']))
    if (!node) throw new HttpError(500, 'no such node')
    return {
      uptime: node.uptime,
      cpu: node.cpu,
      cpuinfo: { cpus: node.maxcpu, model: 'AMD EPYC 7302P 16-Core Processor', sockets: 1 },
      memory: { total: node.maxmem, used: node.mem, free: node.maxmem - node.mem },
      rootfs: { total: node.maxdisk, used: node.disk, avail: node.maxdisk - node.disk },
      loadavg: ['0.42', '0.51', '0.48'],
      pveversion: `pve-manager/${mock.world.current.version.version}`,
      kversion: 'Linux 6.14.11-1-pve',
    }
  })

  on('GET', '/nodes/{node}/rrddata', ({ input, mock }) => {
    const node = mock.world.node(String(input['node']))
    if (!node) throw new HttpError(500, 'no such node')
    return synthRrd(
      node.node,
      String(input['timeframe'] ?? 'hour'),
      { maxcpu: node.maxcpu, maxmem: node.maxmem, maxdisk: node.maxdisk },
      'node',
    )
  })

  on('GET', '/nodes/{node}/tasks', ({ input, mock }) =>
    mock.tasks.list(String(input['node'])).map(taskSummary),
  )

  on('GET', '/nodes/{node}/tasks/{upid}/status', ({ input, mock }) => {
    const task = mock.tasks.get(String(input['upid']))
    if (!task) throw new HttpError(500, 'no such task')
    return {
      ...taskSummary(task),
      status: task.status,
      ...(task.exitstatus ? { exitstatus: task.exitstatus } : {}),
    }
  })

  on('GET', '/nodes/{node}/tasks/{upid}/log', ({ input, mock }) => {
    const task = mock.tasks.get(String(input['upid']))
    if (!task) throw new HttpError(500, 'no such task')

    // Tôn trọng con trỏ `start` — đây chính là thứ chứng minh logic tail log
    // của client đúng, vì gửi lại từ đầu sẽ làm log nhân đôi.
    const start = Number(input['start'] ?? 0)
    const limit = Number(input['limit'] ?? 50)
    return task.log.slice(start, start + limit)
  })

  // ── Guest: danh sách và trạng thái ─────────────────────────────────────────

  // Tạo VM mới — trả UPID `qmcreate`; guest chỉ xuất hiện trong world khi task xong
  // (khớp hành vi Proxmox: cấu hình/đĩa ghi xong mới thấy trong /cluster/resources).
  on('POST', '/nodes/{node}/qemu', ({ input, mock, auth }) => {
    const node = String(input['node'])
    if (!mock.world.node(node)) throw new HttpError(500, 'no such node')

    const vmid = num(input['vmid'])
    if (!Number.isInteger(vmid) || vmid < 100) {
      throw new HttpError(400, 'invalid vmid')
    }
    if (mock.world.guest(vmid)) {
      throw new HttpError(500, `VM ${vmid} already exists`)
    }

    const shouldStart = input['start'] === 1 || input['start'] === '1' || input['start'] === true
    const guest = buildQemuGuestFromCreate(node, vmid, input)

    return runTask(mock, {
      node,
      type: 'qmcreate',
      id: String(vmid),
      user: auth.username,
      onSuccess: () => {
        mock.world.addGuest(guest)
        if (shouldStart) {
          guest.status = 'running'
          guest.uptime = 1
          guest.mem = Math.floor(guest.maxmem * 0.4)
          guest.cpu = 0.02
        }
      },
    })
  })

  // Tạo CT (LXC) — required: node, vmid, ostemplate. Task type thật là `vzcreate`.
  on('POST', '/nodes/{node}/lxc', ({ input, mock, auth }) => {
    const node = String(input['node'])
    if (!mock.world.node(node)) throw new HttpError(500, 'no such node')

    const vmid = num(input['vmid'])
    if (!Number.isInteger(vmid) || vmid < 100) {
      throw new HttpError(400, 'invalid vmid')
    }
    if (mock.world.guest(vmid)) {
      throw new HttpError(500, `CT ${vmid} already exists`)
    }

    const ostemplate = input['ostemplate']
    if (typeof ostemplate !== 'string' || ostemplate.trim() === '') {
      throw new HttpError(400, 'Parameter verification failed. (ostemplate: property is missing and it is not optional)')
    }

    const shouldStart = input['start'] === 1 || input['start'] === '1' || input['start'] === true
    const guest = buildLxcGuestFromCreate(node, vmid, input)

    return runTask(mock, {
      node,
      type: 'vzcreate',
      id: String(vmid),
      user: auth.username,
      onSuccess: () => {
        mock.world.addGuest(guest)
        if (shouldStart) {
          guest.status = 'running'
          guest.uptime = 1
          guest.mem = Math.floor(guest.maxmem * 0.4)
          guest.cpu = 0.02
        }
      },
    })
  })

  for (const type of ['qemu', 'lxc'] as const) {
    on('GET', `/nodes/{node}/${type}`, ({ input, mock }) =>
      mock.world.current.guests
        .filter((g) => g.node === String(input['node']) && g.type === type)
        .map(guestSummary),
    )

    on('GET', `/nodes/{node}/${type}/{vmid}/status/current`, ({ input, mock }) => {
      const guest = requireGuest(mock, String(input['node']), num(input['vmid']), type)
      return {
        ...guestSummary(guest),
        ha: { managed: 0 },
        agent: guest.config['agent'] !== undefined ? 1 : 0,
      }
    })

    on('GET', `/nodes/{node}/${type}/{vmid}/config`, ({ input, mock }) => {
      const guest = requireGuest(mock, String(input['node']), num(input['vmid']), type)
      return { ...guest.config, digest: 'a'.repeat(40) }
    })

    on('PUT', `/nodes/{node}/${type}/{vmid}/config`, ({ input, mock }) => {
      const guest = requireGuest(mock, String(input['node']), num(input['vmid']), type)

      // Proxmox nhận `delete=net0,scsi1` (CSV) để gỡ khóa khỏi config.
      const deleteRaw = input['delete']
      if (typeof deleteRaw === 'string' && deleteRaw.length > 0) {
        for (const key of deleteRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
          delete guest.config[key]
        }
      }

      for (const [key, value] of Object.entries(input)) {
        if (key === 'node' || key === 'vmid' || key === 'digest' || key === 'delete') continue
        if (value === undefined || value === null || value === '') continue
        // form-urlencoded đưa mọi thứ thành chuỗi; ép lại số cho vài scalar quen thuộc
        // để khớp fixture và `/cluster/resources`.
        if (
          typeof value === 'string' &&
          /^(cores|sockets|vcpus|memory|swap|balloon|shares|cpuunits)$/.test(key) &&
          value !== '' &&
          Number.isFinite(Number(value))
        ) {
          guest.config[key] = Number(value)
        } else {
          guest.config[key] = value as string | number
        }
      }

      // Đồng bộ trường tóm tắt dùng bởi /cluster/resources + status/current.
      // QEMU memory trên dây là chuỗi; LXC là số — `num()` nhận cả hai.
      const cores = num(guest.config['cores'] ?? guest.cpus)
      const sockets = num(guest.config['sockets'] ?? 1)
      guest.cpus = Math.max(1, cores * (type === 'qemu' ? sockets : 1))
      if (guest.config['memory'] !== undefined) {
        guest.maxmem = num(guest.config['memory']) * 1024 * 1024
        if (guest.status === 'running') {
          guest.mem = Math.min(guest.mem, guest.maxmem)
        }
      }

      return null
    })

    on('GET', `/nodes/{node}/${type}/{vmid}/snapshot`, ({ input, mock }) => {
      const guest = requireGuest(mock, String(input['node']), num(input['vmid']), type)
      return [
        ...guest.snapshots.map((s) => ({
          name: s.name,
          description: s.description,
          snaptime: s.snaptime,
          vmstate: s.vmstate ? 1 : 0,
          ...(s.parent ? { parent: s.parent } : {}),
        })),
        { name: 'current', description: 'You are here!', digest: 'b'.repeat(40) },
      ]
    })

    const prefix = type === 'qemu' ? 'qm' : 'vz'

    // Đối chiếu với PVE 9.2.2 thật: type task của snapshot LXC là `vzsnapshot` /
    // `vzdelsnapshot`, không phải `qmsnapshot` dùng chung cho cả hai loại guest
    // như suy đoán ban đầu. Trước bản sửa này, POST/DELETE snapshot rơi vào
    // auto-faker và trả về chuỗi không có hình dạng UPID — client không track
    // được, khác hẳn hành vi thật.
    on('POST', `/nodes/{node}/${type}/{vmid}/snapshot`, ({ input, mock, auth }) => {
      const node = String(input['node'])
      const vmid = num(input['vmid'])
      const guest = requireGuest(mock, node, vmid, type)
      const name = String(input['snapname'])

      if (guest.snapshots.some((s) => s.name === name)) {
        throw new HttpError(500, `snapshot '${name}' already exists`)
      }

      return runTask(mock, {
        node,
        type: `${prefix}snapshot`,
        id: String(vmid),
        user: auth.username,
        onSuccess: () => {
          const snapshot: MockSnapshot = {
            name,
            description: typeof input['description'] === 'string' ? input['description'] : '',
            snaptime: Math.floor(Date.now() / 1000),
            vmstate: input['vmstate'] === 1 || input['vmstate'] === '1',
          }
          guest.snapshots.push(snapshot)
        },
      })
    })

    on('DELETE', `/nodes/{node}/${type}/{vmid}/snapshot/{snapname}`, ({ input, mock, auth }) => {
      const node = String(input['node'])
      const vmid = num(input['vmid'])
      const guest = requireGuest(mock, node, vmid, type)
      const name = String(input['snapname'])

      if (!guest.snapshots.some((s) => s.name === name)) {
        throw new HttpError(500, `snapshot '${name}' does not exist`)
      }

      return runTask(mock, {
        node,
        type: `${prefix}delsnapshot`,
        id: String(vmid),
        user: auth.username,
        onSuccess: () => {
          guest.snapshots = guest.snapshots.filter((s) => s.name !== name)
        },
      })
    })

    on('POST', `/nodes/{node}/${type}/{vmid}/snapshot/{snapname}/rollback`, ({ input, mock, auth }) => {
      const node = String(input['node'])
      const vmid = num(input['vmid'])
      const guest = requireGuest(mock, node, vmid, type)
      const name = String(input['snapname'])

      if (!guest.snapshots.some((s) => s.name === name)) {
        throw new HttpError(500, `snapshot '${name}' does not exist`)
      }

      return runTask(mock, { node, type: `${prefix}rollback`, id: String(vmid), user: auth.username })
    })

    // ── Clone / migrate / resize ───────────────────────────────────────────
    on('POST', `/nodes/{node}/${type}/{vmid}/clone`, ({ input, mock, auth }) => {
      const node = String(input['node'])
      const vmid = num(input['vmid'])
      const source = requireGuest(mock, node, vmid, type)
      const newid = num(input['newid'])
      if (!Number.isInteger(newid) || newid < 100) throw new HttpError(400, 'invalid newid')
      if (mock.world.guest(newid)) throw new HttpError(500, `VM ${newid} already exists`)

      const targetNode =
        typeof input['target'] === 'string' && input['target'] !== ''
          ? String(input['target'])
          : node
      if (!mock.world.node(targetNode)) throw new HttpError(500, 'no such node')

      const cloneName =
        type === 'qemu'
          ? String(input['name'] ?? `${source.name}-clone`)
          : String(input['hostname'] ?? `${source.name}-clone`)

      return runTask(mock, {
        node,
        type: type === 'qemu' ? 'qmclone' : 'vzclone',
        id: String(vmid),
        user: auth.username,
        onSuccess: () => {
          const cloned: MockGuest = {
            ...structuredClone(source),
            vmid: newid,
            name: cloneName,
            node: targetNode,
            status: 'stopped',
            uptime: 0,
            mem: 0,
            cpu: 0,
            snapshots: [],
            lock: undefined,
            template: input['full'] === 0 || input['full'] === '0' ? source.template : false,
          }
          if (type === 'qemu') cloned.config['name'] = cloneName
          else cloned.config['hostname'] = cloneName
          mock.world.addGuest(cloned)
        },
      })
    })

    on('POST', `/nodes/{node}/${type}/{vmid}/migrate`, ({ input, mock, auth }) => {
      const node = String(input['node'])
      const vmid = num(input['vmid'])
      const guest = requireGuest(mock, node, vmid, type)
      const target = String(input['target'] ?? '')
      if (!target || !mock.world.node(target)) throw new HttpError(500, 'no such target node')
      if (target === node) throw new HttpError(500, 'target is same as source')

      return runTask(mock, {
        node,
        type: type === 'qemu' ? 'qmigrate' : 'vzmigrate',
        id: String(vmid),
        user: auth.username,
        onSuccess: () => {
          guest.node = target
        },
      })
    })

    on('PUT', `/nodes/{node}/${type}/{vmid}/resize`, ({ input, mock, auth }) => {
      const node = String(input['node'])
      const vmid = num(input['vmid'])
      const guest = requireGuest(mock, node, vmid, type)
      const disk = String(input['disk'] ?? '')
      const sizeRaw = String(input['size'] ?? '')
      if (!disk || !(disk in guest.config)) {
        throw new HttpError(500, `disk '${disk}' does not exist`)
      }
      if (!sizeRaw) throw new HttpError(400, 'missing size')

      return runTask(mock, {
        node,
        type: type === 'qemu' ? 'qmresize' : 'vzresize',
        id: String(vmid),
        user: auth.username,
        onSuccess: () => {
          guest.config[disk] = applyResizeToProperty(String(guest.config[disk]), sizeRaw)
          const bytes = sizeToBytes(sizeRaw.replace(/^\+/, ''))
          if (bytes !== undefined) {
            guest.maxdisk = sizeRaw.startsWith('+') ? guest.maxdisk + bytes : bytes
          }
        },
      })
    })

    // ── RRD ────────────────────────────────────────────────────────────────
    on('GET', `/nodes/{node}/${type}/{vmid}/rrddata`, ({ input, mock }) => {
      const guest = requireGuest(mock, String(input['node']), num(input['vmid']), type)
      return synthRrd(
        `${guest.node}/${type}/${guest.vmid}`,
        String(input['timeframe'] ?? 'hour'),
        { maxcpu: guest.cpus, maxmem: guest.maxmem, maxdisk: guest.maxdisk },
        'guest',
      )
    })

    const power = (
      action: 'start' | 'stop' | 'shutdown' | 'reboot' | 'reset' | 'suspend' | 'resume',
      taskType: string,
      apply: (guest: MockGuest) => void,
    ): void => {
      on('POST', `/nodes/{node}/${type}/{vmid}/status/${action}`, ({ input, mock, auth }) => {
        const node = String(input['node'])
        const vmid = num(input['vmid'])
        const guest = requireGuest(mock, node, vmid, type)

        if (guest.lock) {
          throw new HttpError(500, `VM is locked (${guest.lock})`)
        }
        if (action === 'start' && guest.status === 'running') {
          throw new HttpError(500, `${type === 'qemu' ? 'VM' : 'CT'} ${vmid} already running`)
        }
        if ((action === 'stop' || action === 'shutdown') && guest.status === 'stopped') {
          throw new HttpError(500, `${type === 'qemu' ? 'VM' : 'CT'} ${vmid} not running`)
        }

        // Trạng thái chỉ đổi khi tác vụ xong — giống hệt Proxmox thật, và đó là
        // thứ buộc giao diện phải trung thực về cập nhật lạc quan.
        return runTask(mock, {
          node,
          type: taskType,
          id: String(vmid),
          user: auth.username,
          onSuccess: () => apply(guest),
        })
      })
    }

    power('start', `${prefix}start`, (g) => {
      g.status = 'running'
      g.uptime = 1
      g.mem = Math.floor(g.maxmem * 0.4)
      g.cpu = 0.02
    })
    power('stop', `${prefix}stop`, (g) => {
      g.status = 'stopped'
      g.uptime = 0
      g.mem = 0
      g.cpu = 0
    })
    power('shutdown', `${prefix}shutdown`, (g) => {
      g.status = 'stopped'
      g.uptime = 0
      g.mem = 0
      g.cpu = 0
    })
    power('reboot', `${prefix}reboot`, (g) => {
      g.uptime = 1
    })

    if (type === 'qemu') {
      power('reset', 'qmreset', (g) => {
        g.uptime = 1
      })
      power('suspend', 'qmsuspend', (g) => {
        g.status = 'paused'
      })
      power('resume', 'qmresume', (g) => {
        g.status = 'running'
      })
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  on('GET', '/storage', ({ mock }) =>
    mock.world.current.storages.map((s) => ({
      storage: s.storage,
      type: s.type,
      content: s.content,
      shared: s.shared ? 1 : 0,
      ...(s.nodes ? { nodes: s.nodes } : {}),
    })),
  )

  on('GET', '/nodes/{node}/storage', ({ mock }) =>
    mock.world.current.storages.map((s) => ({
      storage: s.storage,
      type: s.type,
      content: s.content,
      shared: s.shared ? 1 : 0,
      enabled: s.enabled ? 1 : 0,
      active: s.enabled ? 1 : 0,
      total: s.total,
      used: s.used,
      avail: s.avail,
      used_fraction: Number((s.used / s.total).toFixed(4)),
    })),
  )

  on('GET', '/nodes/{node}/storage/{storage}/content', ({ input, mock }) => {
    const storage = mock.world.storage(String(input['storage']))
    if (!storage) throw new HttpError(500, 'storage does not exist')

    const content = input['content']
    return storage.contents
      .filter((v) => (typeof content === 'string' ? v.content === content : true))
      .map((v) => ({
        volid: v.volid,
        format: v.format,
        size: v.size,
        content: v.content,
        ctime: v.ctime,
        ...(v.vmid ? { vmid: v.vmid } : {}),
        ...(v.notes ? { notes: v.notes } : {}),
      }))
  })

  return handlers
}

/** Tham số create không thuộc config guest (meta của API). */
const CREATE_META_KEYS = new Set([
  'node',
  'vmid',
  'start',
  'unique',
  'force',
  'pool',
  'bwlimit',
  'live-restore',
  'storage',
  'ostemplate',
  'password',
  'ssh-public-keys',
  'ignore-unpack-errors',
  'restore',
  'ha-managed',
])

/**
 * Dựng `MockGuest` từ body `POST /nodes/{node}/qemu`.
 * `storage` chỉ là gợi ý mặc định của Proxmox khi tạo đĩa — không lưu vào config.
 */
function buildQemuGuestFromCreate(
  node: string,
  vmid: number,
  input: Record<string, unknown>,
): MockGuest {
  const config: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(input)) {
    if (CREATE_META_KEYS.has(key)) continue
    if (value === undefined || value === null || value === '') continue
    if (
      typeof value === 'string' &&
      /^(cores|sockets|vcpus|memory|swap|balloon|shares|cpuunits)$/.test(key) &&
      Number.isFinite(Number(value))
    ) {
      config[key] = Number(value)
    } else if (typeof value === 'boolean') {
      config[key] = value ? 1 : 0
    } else {
      config[key] = value as string | number
    }
  }

  if (config['cores'] === undefined) config['cores'] = 1
  if (config['sockets'] === undefined) config['sockets'] = 1
  if (config['memory'] === undefined) config['memory'] = 512

  const cores = num(config['cores'])
  const sockets = num(config['sockets'])
  const memoryMiB = num(config['memory'])
  const name =
    typeof config['name'] === 'string' && config['name'] !== ''
      ? String(config['name'])
      : `vm-${vmid}`

  let maxdisk = 0
  for (const [key, value] of Object.entries(config)) {
    if (!/^(scsi|virtio|ide|sata)\d+$/.test(key)) continue
    const raw = String(value)
    const sizeMatch = /(?:^|,)size=(\d+(?:\.\d+)?)([GT])/i.exec(raw)
    if (sizeMatch) {
      const n = Number(sizeMatch[1])
      maxdisk += sizeMatch[2]!.toUpperCase() === 'T' ? n * 1024 ** 4 : n * 1024 ** 3
      continue
    }
    // Dạng tạo mới: `local-lvm:32` (GiB)
    const createMatch = /^[^:]+:(\d+(?:\.\d+)?)$/.exec(raw.split(',')[0] ?? '')
    if (createMatch) {
      maxdisk += Number(createMatch[1]) * 1024 ** 3
    }
  }

  return {
    vmid,
    name,
    type: 'qemu',
    node,
    status: 'stopped',
    cpu: 0,
    cpus: Math.max(1, cores * sockets),
    mem: 0,
    maxmem: memoryMiB * 1024 * 1024,
    disk: 0,
    maxdisk,
    uptime: 0,
    template: config['template'] === 1 || config['template'] === '1',
    ...(typeof config['tags'] === 'string' ? { tags: String(config['tags']) } : {}),
    config,
    snapshots: [],
  }
}

/**
 * Dựng `MockGuest` LXC từ body `POST /nodes/{node}/lxc`.
 * `ostemplate` / `password` chỉ dùng lúc tạo — không ghi vào config.
 */
function buildLxcGuestFromCreate(
  node: string,
  vmid: number,
  input: Record<string, unknown>,
): MockGuest {
  const config: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(input)) {
    if (CREATE_META_KEYS.has(key)) continue
    if (value === undefined || value === null || value === '') continue
    if (
      typeof value === 'string' &&
      /^(cores|memory|swap|cpuunits)$/.test(key) &&
      Number.isFinite(Number(value))
    ) {
      config[key] = Number(value)
    } else if (typeof value === 'boolean') {
      config[key] = value ? 1 : 0
    } else {
      config[key] = value as string | number
    }
  }

  if (config['cores'] === undefined) config['cores'] = 1
  if (config['memory'] === undefined) config['memory'] = 512
  if (config['swap'] === undefined) config['swap'] = 512
  if (config['arch'] === undefined) config['arch'] = 'amd64'
  if (config['unprivileged'] === undefined) config['unprivileged'] = 1

  // rootfs mặc định nếu wizard chỉ gửi storage:size qua tham số rootfs hoặc storage+size ngầm.
  if (config['rootfs'] === undefined) {
    const storage = typeof input['storage'] === 'string' && input['storage'] !== '' ? String(input['storage']) : 'local-lvm'
    config['rootfs'] = `${storage}:8`
  }

  const cores = num(config['cores'])
  const memoryMiB = num(config['memory'])
  const hostname =
    typeof config['hostname'] === 'string' && config['hostname'] !== ''
      ? String(config['hostname'])
      : `ct-${vmid}`
  if (config['hostname'] === undefined) config['hostname'] = hostname

  let maxdisk = 8 * 1024 ** 3
  const rootfs = String(config['rootfs'] ?? '')
  const sizeMatch = /(?:^|,)size=(\d+(?:\.\d+)?)([GT])/i.exec(rootfs)
  if (sizeMatch) {
    const n = Number(sizeMatch[1])
    maxdisk = sizeMatch[2]!.toUpperCase() === 'T' ? n * 1024 ** 4 : n * 1024 ** 3
  } else {
    const createMatch = /^[^:]+:(\d+(?:\.\d+)?)$/.exec(rootfs.split(',')[0] ?? '')
    if (createMatch) maxdisk = Number(createMatch[1]) * 1024 ** 3
  }

  return {
    vmid,
    name: hostname,
    type: 'lxc',
    node,
    status: 'stopped',
    cpu: 0,
    cpus: Math.max(1, cores),
    mem: 0,
    maxmem: memoryMiB * 1024 * 1024,
    disk: 0,
    maxdisk,
    uptime: 0,
    template: config['template'] === 1 || config['template'] === '1',
    ...(typeof config['tags'] === 'string' ? { tags: String(config['tags']) } : {}),
    config,
    snapshots: [],
  }
}

/** Áp dụng `size` dạng `32G` hoặc `+8G` vào property string đĩa/rootfs. */
function applyResizeToProperty(raw: string, sizeRaw: string): string {
  const absolute = sizeRaw.startsWith('+') ? null : sizeRaw
  const parts = raw.split(',').filter(Boolean)
  let found = false
  const next = parts.map((part) => {
    if (part.startsWith('size=')) {
      found = true
      if (absolute) return `size=${absolute}`
      const current = part.slice('size='.length)
      const curBytes = sizeToBytes(current) ?? 0
      const addBytes = sizeToBytes(sizeRaw.slice(1)) ?? 0
      return `size=${bytesToSize(curBytes + addBytes)}`
    }
    return part
  })
  if (!found && absolute) next.push(`size=${absolute}`)
  return next.join(',')
}

function sizeToBytes(raw: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([KMGT])?$/i.exec(raw.trim())
  if (!m) return undefined
  const n = Number(m[1])
  const u = (m[2] ?? 'G').toUpperCase()
  const factor: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
  return n * (factor[u] as number)
}

function bytesToSize(bytes: number): string {
  if (bytes >= 1024 ** 4 && bytes % 1024 ** 4 === 0) return `${bytes / 1024 ** 4}T`
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10}G`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`
  return `${bytes}`
}

function guestSummary(guest: MockGuest): Record<string, unknown> {
  return {
    vmid: guest.vmid,
    name: guest.name,
    status: guest.status,
    cpu: guest.cpu,
    cpus: guest.cpus,
    mem: guest.mem,
    maxmem: guest.maxmem,
    disk: guest.disk,
    maxdisk: guest.maxdisk,
    uptime: guest.uptime,
    template: guest.template ? 1 : 0,
    ...(guest.tags ? { tags: guest.tags } : {}),
    ...(guest.lock ? { lock: guest.lock } : {}),
  }
}

function taskSummary(task: {
  upid: string
  node: string
  pid: number
  starttime: number
  type: string
  id: string
  user: string
  status: 'running' | 'stopped'
  exitstatus?: string
}): Record<string, unknown> {
  return {
    upid: task.upid,
    node: task.node,
    pid: task.pid,
    starttime: task.starttime,
    type: task.type,
    id: task.id,
    user: task.user,
    status: task.status,
    ...(task.exitstatus ? { exitstatus: task.exitstatus, endtime: task.starttime + 5 } : {}),
  }
}

export { failingVariant }
