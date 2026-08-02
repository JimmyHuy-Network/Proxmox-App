import { HttpError, type HandlerTable, type MockHandler } from '../router.ts'
import { templateFor } from '../tasks/engine.ts'
import type { MockContext } from '../context.ts'
import type { MockIface, NodeInfraState } from '../state/node-infra.ts'
import { defaultNodeInfra, cloneIfaces } from '../state/node-infra.ts'

/**
 * Handlers hạ tầng node — mạng (pending/apply/revert), DNS, hosts, time (GĐ 7).
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

function infra(mock: MockContext, node: string): NodeInfraState {
  requireNode(mock, node)
  return mock.ensureNodeInfra(node)
}

function ifaceRow(iface: MockIface): Record<string, unknown> {
  const row: Record<string, unknown> = {
    iface: iface.iface,
    type: iface.type,
    method: iface.method ?? 'manual',
    active: iface.active ? 1 : 0,
    autostart: iface.autostart ? 1 : 0,
    exists: iface.exists !== false ? 1 : 0,
  }
  for (const key of [
    'address',
    'netmask',
    'gateway',
    'cidr',
    'bridge_ports',
    'bridge_vids',
    'slaves',
    'bond_mode',
    'bond-primary',
    'vlan-id',
    'vlan-raw-device',
    'comments',
    'mtu',
  ] as const) {
    const v = iface[key]
    if (v !== undefined && v !== '') row[key] = v
  }
  if (iface.bridge_vlan_aware !== undefined) row['bridge_vlan_aware'] = iface.bridge_vlan_aware ? 1 : 0
  return row
}

function runTask(
  mock: MockContext,
  init: { node: string; type: string; id: string; user: string; onSuccess?: () => void },
): string {
  const steps = templateFor(init.type)
  return mock.tasks.startTask({ ...init, steps }).upid
}

function registerNodeInfraHandlers(
  on: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler) => void,
): void {
  // ── Network list / create / apply / revert ─────────────────────────────────

  on('GET', '/nodes/{node}/network', ({ input, mock }) => {
    const node = str(input['node'])
    const state = infra(mock, node)
    const typeFilter = input['type']
    return state.network
      .filter((i) => (typeof typeFilter === 'string' ? i.type === typeFilter : true))
      .map(ifaceRow)
  })

  on('POST', '/nodes/{node}/network', ({ input, mock }) => {
    const node = str(input['node'])
    const state = infra(mock, node)
    const iface = str(input['iface'])
    const type = str(input['type'])
    if (!iface || !type) {
      throw new HttpError(400, 'Parameter verification failed.', {
        ...(iface ? {} : { iface: 'parameter is missing' }),
        ...(type ? {} : { type: 'parameter is missing' }),
      })
    }
    if (state.network.some((i) => i.iface === iface)) {
      throw new HttpError(500, `interface '${iface}' already exists`)
    }

    const created: MockIface = {
      iface,
      type,
      method: input['address'] || input['cidr'] ? 'static' : 'manual',
      active: false,
      autostart: input['autostart'] === undefined ? true : truthy(input['autostart']),
      exists: true,
    }
    for (const key of [
      'address',
      'netmask',
      'gateway',
      'cidr',
      'bridge_ports',
      'bridge_vids',
      'slaves',
      'bond_mode',
      'bond-primary',
      'vlan-id',
      'vlan-raw-device',
      'comments',
      'mtu',
    ] as const) {
      if (input[key] !== undefined) created[key] = str(input[key])
    }
    if (input['bridge_vlan_aware'] !== undefined) {
      created.bridge_vlan_aware = truthy(input['bridge_vlan_aware'])
    }

    state.network.push(created)
    state.networkPending = true
    return null
  })

  // Apply / reload — trả UPID
  on('PUT', '/nodes/{node}/network', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const state = infra(mock, node)
    return runTask(mock, {
      node,
      type: 'networkreload',
      id: node,
      user: auth.username,
      onSuccess: () => {
        state.committed = cloneIfaces(state.network)
        for (const iface of state.network) {
          if (iface.type !== 'eth' || iface.active) iface.active = true
        }
        state.networkPending = false
      },
    })
  })

  // Revert pending
  on('DELETE', '/nodes/{node}/network', ({ input, mock }) => {
    const node = str(input['node'])
    const state = infra(mock, node)
    state.network = cloneIfaces(state.committed)
    state.networkPending = false
    return null
  })

  on('GET', '/nodes/{node}/network/{iface}', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    const name = str(input['iface'])
    const found = state.network.find((i) => i.iface === name)
    if (!found) {
      // Contract / probe: trả stub thay vì 500 khi iface chưa có trong seed.
      return ifaceRow({
        iface: name,
        type: 'eth',
        method: 'manual',
        active: false,
        autostart: false,
        exists: false,
      })
    }
    return ifaceRow(found)
  })

  on('PUT', '/nodes/{node}/network/{iface}', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    const name = str(input['iface'])
    const found = state.network.find((i) => i.iface === name)
    if (!found) throw new HttpError(500, `interface '${name}' does not exist`)

    if (input['type'] !== undefined) found.type = str(input['type'])
    if (input['autostart'] !== undefined) found.autostart = truthy(input['autostart'])
    for (const key of [
      'address',
      'netmask',
      'gateway',
      'cidr',
      'bridge_ports',
      'bridge_vids',
      'slaves',
      'bond_mode',
      'bond-primary',
      'vlan-id',
      'vlan-raw-device',
      'comments',
      'mtu',
    ] as const) {
      if (input[key] !== undefined) found[key] = str(input[key])
    }
    if (input['bridge_vlan_aware'] !== undefined) {
      found.bridge_vlan_aware = truthy(input['bridge_vlan_aware'])
    }
    if (input['delete'] !== undefined) {
      for (const field of str(input['delete']).split(',')) {
        const f = field.trim()
        if (f) delete found[f as keyof MockIface]
      }
    }
    state.networkPending = true
    return null
  })

  on('DELETE', '/nodes/{node}/network/{iface}', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    const name = str(input['iface'])
    const before = state.network.length
    state.network = state.network.filter((i) => i.iface !== name)
    if (state.network.length === before) throw new HttpError(500, `interface '${name}' does not exist`)
    state.networkPending = true
    return null
  })

  // ── DNS ────────────────────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/dns', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    return {
      search: state.dns.search,
      ...(state.dns.dns1 ? { dns1: state.dns.dns1 } : {}),
      ...(state.dns.dns2 ? { dns2: state.dns.dns2 } : {}),
      ...(state.dns.dns3 ? { dns3: state.dns.dns3 } : {}),
    }
  })

  on('PUT', '/nodes/{node}/dns', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    state.dns.search = str(input['search'])
    if (input['dns1'] !== undefined) state.dns.dns1 = str(input['dns1'])
    if (input['dns2'] !== undefined) state.dns.dns2 = str(input['dns2'])
    if (input['dns3'] !== undefined) state.dns.dns3 = str(input['dns3'])
    return null
  })

  // ── Hosts ──────────────────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/hosts', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    return { data: state.hosts, digest: 'mockdigest0001' }
  })

  on('POST', '/nodes/{node}/hosts', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    state.hosts = str(input['data'])
    return null
  })

  // ── Time ───────────────────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/time', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    const now = Math.floor(Date.now() / 1000)
    return {
      timezone: state.timezone,
      time: now,
      localtime: now,
    }
  })

  on('PUT', '/nodes/{node}/time', ({ input, mock }) => {
    const state = infra(mock, str(input['node']))
    state.timezone = str(input['timezone'])
    return null
  })
}

/** Endpoint phụ trợ — UI hỏi “có thay đổi chờ apply không?” */
export function networkPending(mock: MockContext, node: string): boolean {
  return mock.ensureNodeInfra(node).networkPending
}

export function applyNodeInfraHandlers(handlers: HandlerTable): void {
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[`${method} ${path}`] = handler
  }
  registerNodeInfraHandlers(on)
}

export { defaultNodeInfra }
