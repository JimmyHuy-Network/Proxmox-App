import { HttpError, type HandlerTable, type MockHandler } from '../router.ts'
import type { MockContext } from '../context.ts'
import { requirePriv } from './access.ts'
import { templateFor } from '../tasks/engine.ts'

/**
 * SDN + HA + ZFS replication + notification targets + metric servers (GĐ 8).
 */

function str(value: unknown): string {
  return String(value ?? '')
}

function runTask(
  mock: MockContext,
  init: { node: string; type: string; id: string; user: string; onSuccess?: () => void },
): string {
  return mock.tasks.startTask({ ...init, steps: templateFor(init.type) }).upid
}

function register(on: (m: 'GET' | 'POST' | 'PUT' | 'DELETE', p: string, h: MockHandler) => void): void {
  // ── SDN ────────────────────────────────────────────────────────────────────
  on('GET', '/cluster/sdn', () => [
    { name: 'zones' },
    { name: 'vnets' },
    { name: 'controllers' },
    { name: 'ipams' },
    { name: 'dns' },
  ])

  on('GET', '/cluster/sdn/zones', ({ mock }) => mock.phase8.sdn.zones.map((z) => ({ ...z })))
  on('POST', '/cluster/sdn/zones', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const zone = str(input['zone'])
    if (mock.phase8.sdn.zones.some((z) => z.zone === zone)) {
      throw new HttpError(400, 'zone already exists')
    }
    mock.phase8.sdn.zones.push({
      zone,
      type: str(input['type'] || 'simple'),
      ipam: str(input['ipam'] || 'pve'),
      mtu: input['mtu'] !== undefined ? Number(input['mtu']) : 1500,
      nodes: str(input['nodes'] || '') || undefined,
      state: 'available',
      pending: true,
    })
    return null
  })
  on('GET', '/cluster/sdn/zones/{zone}', ({ mock, input }) => {
    const z = mock.phase8.sdn.zones.find((x) => x.zone === str(input['zone']))
    if (!z) throw new HttpError(500, 'no such zone')
    return { ...z }
  })
  on('PUT', '/cluster/sdn/zones/{zone}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const z = mock.phase8.sdn.zones.find((x) => x.zone === str(input['zone']))
    if (!z) throw new HttpError(500, 'no such zone')
    for (const [k, v] of Object.entries(input)) {
      if (k === 'zone') continue
      z[k] = v
    }
    z.pending = true
    return null
  })
  on('DELETE', '/cluster/sdn/zones/{zone}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const zone = str(input['zone'])
    mock.phase8.sdn.zones = mock.phase8.sdn.zones.filter((z) => z.zone !== zone)
    mock.phase8.sdn.vnets = mock.phase8.sdn.vnets.filter((v) => v.zone !== zone)
    return null
  })

  on('GET', '/cluster/sdn/vnets', ({ mock }) => mock.phase8.sdn.vnets.map((v) => ({ ...v })))
  on('POST', '/cluster/sdn/vnets', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const vnet = str(input['vnet'])
    if (mock.phase8.sdn.vnets.some((v) => v.vnet === vnet)) {
      throw new HttpError(400, 'vnet already exists')
    }
    mock.phase8.sdn.vnets.push({
      vnet,
      zone: str(input['zone']),
      tag: input['tag'] !== undefined ? Number(input['tag']) : undefined,
      alias: str(input['alias'] || '') || undefined,
      type: 'vnet',
    })
    return null
  })
  on('GET', '/cluster/sdn/vnets/{vnet}', ({ mock, input }) => {
    const v = mock.phase8.sdn.vnets.find((x) => x.vnet === str(input['vnet']))
    if (!v) throw new HttpError(500, 'no such vnet')
    return { ...v }
  })
  on('PUT', '/cluster/sdn/vnets/{vnet}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const v = mock.phase8.sdn.vnets.find((x) => x.vnet === str(input['vnet']))
    if (!v) throw new HttpError(500, 'no such vnet')
    for (const [k, val] of Object.entries(input)) {
      if (k === 'vnet') continue
      v[k] = val
    }
    return null
  })
  on('DELETE', '/cluster/sdn/vnets/{vnet}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const vnet = str(input['vnet'])
    mock.phase8.sdn.vnets = mock.phase8.sdn.vnets.filter((v) => v.vnet !== vnet)
    mock.phase8.sdn.subnets = mock.phase8.sdn.subnets.filter((s) => s.vnet !== vnet)
    return null
  })

  on('GET', '/cluster/sdn/vnets/{vnet}/subnets', ({ mock, input }) => {
    const vnet = str(input['vnet'])
    return mock.phase8.sdn.subnets.filter((s) => s.vnet === vnet).map((s) => ({ ...s }))
  })
  on('POST', '/cluster/sdn/vnets/{vnet}/subnets', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const vnet = str(input['vnet'])
    const subnet = str(input['subnet'])
    const id = subnet.includes('/') && !subnet.includes(vnet) ? `${mock.phase8.sdn.vnets.find((v) => v.vnet === vnet)?.zone ?? 'zone'}/${subnet}` : subnet
    mock.phase8.sdn.subnets.push({
      subnet: id,
      vnet,
      gateway: str(input['gateway'] || '') || undefined,
      snat: input['snat'] === 1 || input['snat'] === '1' ? 1 : undefined,
      type: 'subnet',
    })
    return null
  })
  on('DELETE', '/cluster/sdn/vnets/{vnet}/subnets/{subnet}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const subnet = decodeURIComponent(str(input['subnet']))
    mock.phase8.sdn.subnets = mock.phase8.sdn.subnets.filter((s) => s.subnet !== subnet)
    return null
  })

  on('GET', '/cluster/sdn/controllers', ({ mock }) =>
    mock.phase8.sdn.controllers.map((c) => ({ ...c })),
  )
  on('POST', '/cluster/sdn/controllers', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const controller = str(input['controller'])
    mock.phase8.sdn.controllers.push({
      controller,
      type: str(input['type'] || 'evpn'),
      asn: input['asn'] !== undefined ? Number(input['asn']) : undefined,
    })
    return null
  })
  on('DELETE', '/cluster/sdn/controllers/{controller}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    const controller = str(input['controller'])
    mock.phase8.sdn.controllers = mock.phase8.sdn.controllers.filter((c) => c.controller !== controller)
    return null
  })

  on('GET', '/cluster/sdn/ipams', ({ mock }) => mock.phase8.sdn.ipams.map((i) => ({ ...i })))
  on('POST', '/cluster/sdn/ipams', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    mock.phase8.sdn.ipams.push({
      ipam: str(input['ipam']),
      type: str(input['type'] || 'pve'),
    })
    return null
  })

  on('PUT', '/cluster/sdn', ({ mock, auth }) => {
    requirePriv(mock, auth.username, '/sdn', 'SDN.Allocate')
    // Apply pending — clear pending flags
    for (const z of mock.phase8.sdn.zones) z.pending = false
    const node = mock.world.current.nodes[0]?.node ?? 'pve1'
    return runTask(mock, {
      node,
      type: 'srapply',
      id: 'sdn',
      user: auth.username,
    })
  })

  // ── HA ─────────────────────────────────────────────────────────────────────
  on('GET', '/cluster/ha', () => [
    { name: 'groups' },
    { name: 'resources' },
    { name: 'rules' },
    { name: 'status' },
  ])

  on('GET', '/cluster/ha/groups', ({ mock }) => mock.phase8.ha.groups.map((g) => ({ ...g })))
  on('POST', '/cluster/ha/groups', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const group = str(input['group'])
    if (mock.phase8.ha.groups.some((g) => g.group === group)) {
      throw new HttpError(400, 'ha group already exists')
    }
    mock.phase8.ha.groups.push({
      group,
      nodes: str(input['nodes']),
      comment: str(input['comment'] || '') || undefined,
      restricted: input['restricted'] === 1 || input['restricted'] === '1' ? 1 : 0,
      nofailback: input['nofailback'] === 1 || input['nofailback'] === '1' ? 1 : 0,
    })
    return null
  })
  on('GET', '/cluster/ha/groups/{group}', ({ mock, input }) => {
    const g = mock.phase8.ha.groups.find((x) => x.group === str(input['group']))
    if (!g) throw new HttpError(500, 'no such ha group')
    return { ...g }
  })
  on('PUT', '/cluster/ha/groups/{group}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const g = mock.phase8.ha.groups.find((x) => x.group === str(input['group']))
    if (!g) throw new HttpError(500, 'no such ha group')
    if (input['nodes'] !== undefined) g.nodes = str(input['nodes'])
    if (input['comment'] !== undefined) g.comment = str(input['comment']) || undefined
    return null
  })
  on('DELETE', '/cluster/ha/groups/{group}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const group = str(input['group'])
    mock.phase8.ha.groups = mock.phase8.ha.groups.filter((g) => g.group !== group)
    return null
  })

  on('GET', '/cluster/ha/resources', ({ mock }) => mock.phase8.ha.resources.map((r) => ({ ...r })))
  on('POST', '/cluster/ha/resources', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const sid = str(input['sid'])
    if (mock.phase8.ha.resources.some((r) => r.sid === sid)) {
      throw new HttpError(400, 'ha resource already exists')
    }
    mock.phase8.ha.resources.push({
      sid,
      state: str(input['state'] || 'started'),
      group: str(input['group'] || '') || undefined,
      max_restart: input['max_restart'] !== undefined ? Number(input['max_restart']) : 1,
      max_relocate: input['max_relocate'] !== undefined ? Number(input['max_relocate']) : 1,
      comment: str(input['comment'] || '') || undefined,
    })
    return null
  })
  on('GET', '/cluster/ha/resources/{sid}', ({ mock, input }) => {
    const sid = decodeURIComponent(str(input['sid']))
    const r = mock.phase8.ha.resources.find((x) => x.sid === sid)
    if (!r) throw new HttpError(500, 'no such ha resource')
    return { ...r }
  })
  on('PUT', '/cluster/ha/resources/{sid}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const sid = decodeURIComponent(str(input['sid']))
    const r = mock.phase8.ha.resources.find((x) => x.sid === sid)
    if (!r) throw new HttpError(500, 'no such ha resource')
    if (input['state'] !== undefined) r.state = str(input['state'])
    if (input['group'] !== undefined) r.group = str(input['group']) || undefined
    return null
  })
  on('DELETE', '/cluster/ha/resources/{sid}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const sid = decodeURIComponent(str(input['sid']))
    mock.phase8.ha.resources = mock.phase8.ha.resources.filter((r) => r.sid !== sid)
    return null
  })

  on('GET', '/cluster/ha/rules', ({ mock }) => mock.phase8.ha.rules.map((r) => ({ ...r })))
  on('POST', '/cluster/ha/rules', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const rule = str(input['rule'])
    mock.phase8.ha.rules.push({
      rule,
      type: str(input['type'] || 'node-affinity'),
      resources: str(input['resources'] || '') || undefined,
      affinity: str(input['affinity'] || '') || undefined,
      comment: str(input['comment'] || '') || undefined,
    })
    return null
  })
  on('DELETE', '/cluster/ha/rules/{rule}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const rule = str(input['rule'])
    mock.phase8.ha.rules = mock.phase8.ha.rules.filter((r) => r.rule !== rule)
    return null
  })

  on('GET', '/cluster/ha/status', () => [{ name: 'current' }, { name: 'manager_status' }])
  on('GET', '/cluster/ha/status/current', ({ mock }) => {
    const nodes = mock.world.current.nodes
    return [
      ...nodes.map((n) => ({
        id: `node/${n.node}`,
        type: 'node',
        node: n.node,
        status: n.status === 'online' ? 'online' : 'offline',
        quorate: n.status === 'online' ? 1 : 0,
      })),
      ...mock.phase8.ha.resources.map((r) => ({
        id: r.sid,
        sid: r.sid,
        type: 'service',
        state: r.state ?? 'started',
        status: 'OK',
        node: nodes.find((n) => n.status === 'online')?.node ?? nodes[0]?.node,
        group: r.group,
      })),
    ]
  })
  on('GET', '/cluster/ha/status/manager_status', ({ mock }) => ({
    master_node: mock.world.current.nodes.find((n) => n.status === 'online')?.node ?? 'pve1',
    node_status: Object.fromEntries(
      mock.world.current.nodes.map((n) => [n.node, n.status === 'online' ? 'online' : 'offline']),
    ),
  }))

  // ── Replication ────────────────────────────────────────────────────────────
  on('GET', '/cluster/replication', ({ mock }) =>
    mock.phase8.replication.map((j) => ({
      id: j.id,
      guest: j.guest,
      target: j.target,
      schedule: j.schedule ?? '*/15',
      type: j.type ?? 'local',
      enabled: j.enabled ?? 1,
      ...(j.comment ? { comment: j.comment } : {}),
      ...(j.last_sync ? { last_sync: j.last_sync } : {}),
      ...(j.error ? { error: j.error } : {}),
    })),
  )
  on('POST', '/cluster/replication', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'VM.Allocate')
    const guest = Number(input['guest'])
    const target = str(input['target'])
    const existing = mock.phase8.replication.filter((j) => j.guest === guest)
    const id = `${guest}-${existing.length}`
    mock.phase8.replication.push({
      id,
      guest,
      target,
      schedule: str(input['schedule'] || '*/15'),
      type: str(input['type'] || 'local'),
      enabled: input['disable'] === 1 || input['disable'] === '1' ? 0 : 1,
      comment: str(input['comment'] || '') || undefined,
    })
    return null
  })
  on('GET', '/cluster/replication/{id}', ({ mock, input }) => {
    const j = mock.phase8.replication.find((x) => x.id === str(input['id']))
    if (!j) throw new HttpError(500, 'no such replication job')
    return { ...j }
  })
  on('PUT', '/cluster/replication/{id}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'VM.Allocate')
    const j = mock.phase8.replication.find((x) => x.id === str(input['id']))
    if (!j) throw new HttpError(500, 'no such replication job')
    if (input['schedule'] !== undefined) j.schedule = str(input['schedule'])
    if (input['comment'] !== undefined) j.comment = str(input['comment']) || undefined
    if (input['disable'] !== undefined) {
      j.enabled = input['disable'] === 1 || input['disable'] === '1' ? 0 : 1
    }
    return null
  })
  on('DELETE', '/cluster/replication/{id}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'VM.Allocate')
    const id = str(input['id'])
    mock.phase8.replication = mock.phase8.replication.filter((j) => j.id !== id)
    return null
  })

  on('GET', '/nodes/{node}/replication', ({ mock, input }) => {
    const node = str(input['node'])
    // Jobs whose guest currently lives on this node, or target is this node
    return mock.phase8.replication
      .filter((j) => {
        const guest = mock.world.current.guests.find((g) => g.vmid === j.guest)
        return guest?.node === node || j.target === node
      })
      .map((j) => ({ ...j }))
  })
  on('POST', '/nodes/{node}/replication/{id}/schedule_now', ({ mock, input, auth }) => {
    const id = str(input['id'])
    const j = mock.phase8.replication.find((x) => x.id === id)
    if (!j) throw new HttpError(500, 'no such replication job')
    const node = str(input['node'])
    return runTask(mock, {
      node,
      type: 'replication',
      id,
      user: auth.username,
      onSuccess: () => {
        j.last_sync = Math.floor(Date.now() / 1000)
        j.error = undefined
      },
    })
  })
  on('GET', '/nodes/{node}/replication/{id}/status', ({ mock, input }) => {
    const j = mock.phase8.replication.find((x) => x.id === str(input['id']))
    if (!j) throw new HttpError(500, 'no such replication job')
    return {
      last_sync: j.last_sync ?? 0,
      duration: 12,
      last_try: j.last_sync ?? 0,
      fail_count: j.error ? 1 : 0,
      error: j.error,
    }
  })
  on('GET', '/nodes/{node}/replication/{id}/log', () => [
    { t: Math.floor(Date.now() / 1000) - 60, n: 1, text: 'trying to get exclusive lock...' },
    { t: Math.floor(Date.now() / 1000) - 50, n: 2, text: 'replicating snapshot...' },
    { t: Math.floor(Date.now() / 1000) - 40, n: 3, text: 'end replication successfully' },
  ])

  // ── Notifications ──────────────────────────────────────────────────────────
  on('GET', '/cluster/notifications', () => [
    { name: 'endpoints' },
    { name: 'targets' },
    { name: 'matchers' },
  ])
  on('GET', '/cluster/notifications/targets', ({ mock }) =>
    mock.phase8.notifications.targets.map((t) => ({
      name: t.name,
      type: t.type,
      ...(t.comment ? { comment: t.comment } : {}),
      disable: t.disable ?? 0,
      'origin': 'user-created',
    })),
  )
  on('POST', '/cluster/notifications/targets/{name}/test', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const name = str(input['name'])
    if (!mock.phase8.notifications.targets.some((t) => t.name === name)) {
      throw new HttpError(500, 'no such target')
    }
    return null
  })

  on('GET', '/cluster/notifications/endpoints', () => [
    { name: 'sendmail' },
    { name: 'smtp' },
    { name: 'gotify' },
    { name: 'webhook' },
  ])

  for (const kind of ['sendmail', 'smtp', 'gotify', 'webhook'] as const) {
    on('GET', `/cluster/notifications/endpoints/${kind}`, ({ mock }) =>
      mock.phase8.notifications.targets.filter((t) => t.type === kind).map((t) => ({ ...t })),
    )
    on('POST', `/cluster/notifications/endpoints/${kind}`, ({ mock, input, auth }) => {
      requirePriv(mock, auth.username, '/', 'Sys.Modify')
      const name = str(input['name'])
      if (mock.phase8.notifications.targets.some((t) => t.name === name)) {
        throw new HttpError(400, 'target already exists')
      }
      mock.phase8.notifications.targets.push({
        name,
        type: kind,
        comment: str(input['comment'] || '') || undefined,
        disable: input['disable'] === 1 || input['disable'] === '1' ? 1 : 0,
        ...Object.fromEntries(
          Object.entries(input).filter(
            ([k]) => !['name', 'comment', 'disable', 'type'].includes(k),
          ),
        ),
      })
      return null
    })
    on('GET', `/cluster/notifications/endpoints/${kind}/{name}`, ({ mock, input }) => {
      const t = mock.phase8.notifications.targets.find(
        (x) => x.name === str(input['name']) && x.type === kind,
      )
      if (!t) throw new HttpError(500, 'no such endpoint')
      return { ...t }
    })
    on('PUT', `/cluster/notifications/endpoints/${kind}/{name}`, ({ mock, input, auth }) => {
      requirePriv(mock, auth.username, '/', 'Sys.Modify')
      const t = mock.phase8.notifications.targets.find(
        (x) => x.name === str(input['name']) && x.type === kind,
      )
      if (!t) throw new HttpError(500, 'no such endpoint')
      for (const [k, v] of Object.entries(input)) {
        if (k === 'name') continue
        t[k] = v
      }
      return null
    })
    on('DELETE', `/cluster/notifications/endpoints/${kind}/{name}`, ({ mock, input, auth }) => {
      requirePriv(mock, auth.username, '/', 'Sys.Modify')
      const name = str(input['name'])
      mock.phase8.notifications.targets = mock.phase8.notifications.targets.filter(
        (t) => !(t.name === name && t.type === kind),
      )
      return null
    })
  }

  on('GET', '/cluster/notifications/matchers', ({ mock }) =>
    mock.phase8.notifications.matchers.map((m) => ({ ...m })),
  )
  on('POST', '/cluster/notifications/matchers', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const name = str(input['name'])
    mock.phase8.notifications.matchers.push({
      name,
      match_severity: str(input['match-severity'] || input['match_severity'] || '') || undefined,
      match_field: str(input['match-field'] || input['match_field'] || '') || undefined,
      target: str(input['target'] || '') || undefined,
      comment: str(input['comment'] || '') || undefined,
      disable: input['disable'] === 1 || input['disable'] === '1' ? 1 : 0,
    })
    return null
  })
  on('DELETE', '/cluster/notifications/matchers/{name}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const name = str(input['name'])
    mock.phase8.notifications.matchers = mock.phase8.notifications.matchers.filter(
      (m) => m.name !== name,
    )
    return null
  })

  // ── Metrics ────────────────────────────────────────────────────────────────
  on('GET', '/cluster/metrics', () => [{ name: 'server' }])
  on('GET', '/cluster/metrics/server', ({ mock }) =>
    mock.phase8.metrics.map((m) => ({
      id: m.id,
      type: m.type,
      server: m.server,
      ...(m.port !== undefined ? { port: m.port } : {}),
      disable: m.disable ?? 0,
      ...(m.path ? { path: m.path } : {}),
      ...(m.proto ? { proto: m.proto } : {}),
    })),
  )
  on('POST', '/cluster/metrics/server/{id}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const id = str(input['id'])
    if (mock.phase8.metrics.some((m) => m.id === id)) {
      throw new HttpError(400, 'metric server already exists')
    }
    mock.phase8.metrics.push({
      id,
      type: str(input['type'] || 'influxdb'),
      server: str(input['server']),
      port: input['port'] !== undefined ? Number(input['port']) : undefined,
      path: str(input['path'] || '') || undefined,
      proto: str(input['proto'] || '') || undefined,
      disable: input['disable'] === 1 || input['disable'] === '1' ? 1 : 0,
    })
    return null
  })
  on('GET', '/cluster/metrics/server/{id}', ({ mock, input }) => {
    const m = mock.phase8.metrics.find((x) => x.id === str(input['id']))
    if (!m) throw new HttpError(500, 'no such metric server')
    return { ...m }
  })
  on('PUT', '/cluster/metrics/server/{id}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const m = mock.phase8.metrics.find((x) => x.id === str(input['id']))
    if (!m) throw new HttpError(500, 'no such metric server')
    if (input['server'] !== undefined) m.server = str(input['server'])
    if (input['port'] !== undefined) m.port = Number(input['port'])
    if (input['disable'] !== undefined) {
      m.disable = input['disable'] === 1 || input['disable'] === '1' ? 1 : 0
    }
    return null
  })
  on('DELETE', '/cluster/metrics/server/{id}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const id = str(input['id'])
    mock.phase8.metrics = mock.phase8.metrics.filter((m) => m.id !== id)
    return null
  })
}

export function applySdnHaHandlers(handlers: HandlerTable): void {
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[`${method} ${path}`] = handler
  }
  register(on)
}
