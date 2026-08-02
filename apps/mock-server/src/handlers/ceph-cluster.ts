import { HttpError, type HandlerTable, type MockHandler } from '../router.ts'
import { templateFor } from '../tasks/engine.ts'
import type { MockContext } from '../context.ts'

/**
 * Ceph + cluster create/join (GĐ 7).
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

function cephStatusPayload(mock: MockContext): Record<string, unknown> {
  const c = mock.ceph
  return {
    health: {
      status: c.health,
      checks:
        c.health === 'HEALTH_OK'
          ? {}
          : {
              OSD_DOWN: {
                severity: 'HEALTH_WARN',
                summary: { message: '1 osd down', count: 1 },
              },
            },
    },
    fsid: c.fsid,
    monmap: c.monmap,
    osdmap: c.osdmap,
    pgmap: c.pgmap,
    quorum_names: c.mons.filter((m) => m.quorum).map((m) => m.name),
  }
}

function register(on: (m: 'GET' | 'POST' | 'PUT' | 'DELETE', p: string, h: MockHandler) => void): void {
  on('GET', '/cluster/ceph', () => [{ name: 'status' }, { name: 'metadata' }, { name: 'flags' }])
  on('GET', '/cluster/ceph/status', ({ mock }) => cephStatusPayload(mock))

  on('GET', '/nodes/{node}/ceph', ({ input, mock }) => {
    if (!mock.world.node(str(input['node']))) throw new HttpError(500, 'no such node')
    return [{ name: 'status' }, { name: 'osd' }, { name: 'mon' }, { name: 'pool' }, { name: 'fs' }]
  })

  on('GET', '/nodes/{node}/ceph/status', ({ input, mock }) => {
    if (!mock.world.node(str(input['node']))) throw new HttpError(500, 'no such node')
    return cephStatusPayload(mock)
  })

  on('GET', '/nodes/{node}/ceph/osd', ({ input, mock }) => {
    if (!mock.world.node(str(input['node']))) throw new HttpError(500, 'no such node')
    const c = mock.ceph
    return {
      flags: [],
      root: {
        id: -1,
        name: 'default',
        type: 'root',
        children: c.osds.map((o) => ({
          id: o.id,
          name: o.name,
          type: 'osd',
          status: o.status,
          host: o.host,
          crush_weight: o.weight,
        })),
      },
    }
  })

  on('POST', '/nodes/{node}/ceph/osd', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const dev = str(input['dev'])
    return runTask(mock, {
      node,
      type: 'cephosdcreate',
      id: dev,
      user: auth.username,
      onSuccess: () => {
        const id = mock.ceph.osds.reduce((m, o) => Math.max(m, o.id), -1) + 1
        mock.ceph.osds.push({ id, name: `osd.${id}`, host: node, status: 'up', weight: 1 })
        mock.ceph.osdmap.num_osds += 1
        mock.ceph.osdmap.num_up_osds += 1
        mock.ceph.osdmap.num_in_osds += 1
      },
    })
  })

  on('GET', '/nodes/{node}/ceph/mon', ({ input, mock }) => {
    if (!mock.world.node(str(input['node']))) throw new HttpError(500, 'no such node')
    return mock.ceph.mons.map((m) => ({
      name: m.name,
      host: m.host,
      rank: m.rank,
      quorum: m.quorum ? 1 : 0,
      state: m.state,
      addr: `192.168.1.${10 + m.rank}:6789`,
    }))
  })

  on('GET', '/nodes/{node}/ceph/pool', ({ input, mock }) => {
    if (!mock.world.node(str(input['node']))) throw new HttpError(500, 'no such node')
    return mock.ceph.pools.map((p) => ({
      pool: p.pool,
      pool_name: p.pool_name,
      name: p.pool_name,
      size: p.size,
      min_size: p.min_size,
      pg_num: p.pg_num,
      bytes_used: p.bytes_used,
    }))
  })

  on('POST', '/nodes/{node}/ceph/pool', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const name = str(input['name'])
    return runTask(mock, {
      node,
      type: 'cephpoolcreate',
      id: name,
      user: auth.username,
      onSuccess: () => {
        const pool = mock.ceph.pools.reduce((m, p) => Math.max(m, p.pool), 0) + 1
        mock.ceph.pools.push({
          pool,
          pool_name: name,
          size: Number(input['size'] ?? 3) || 3,
          min_size: Number(input['min_size'] ?? 2) || 2,
          pg_num: Number(input['pg_num'] ?? 32) || 32,
          bytes_used: 0,
        })
      },
    })
  })

  // ── Cluster config ─────────────────────────────────────────────────────────

  on('GET', '/cluster/config', ({ mock }) => {
    return [
      { name: 'nodes' },
      { name: 'join' },
      { name: 'totem' },
      { name: 'apiversion' },
      ...(mock.clusterConfig.created ? [] : [{ name: 'create' }]),
    ]
  })

  on('POST', '/cluster/config', ({ input, mock, auth }) => {
    const clustername = str(input['clustername'])
    const node = mock.world.current.nodes[0]?.node ?? 'pve1'
    return runTask(mock, {
      node,
      type: 'clustercreate',
      id: clustername,
      user: auth.username,
      onSuccess: () => {
        mock.clusterConfig.created = true
        mock.clusterConfig.clustername = clustername
        mock.world.current.clusterName = clustername
        mock.clusterConfig.nodes = mock.world.current.nodes.map((n) => n.node)
      },
    })
  })

  on('GET', '/cluster/config/join', ({ mock }) => {
    const nodes = mock.world.current.nodes
    return {
      config_digest: 'mockcorosyncdigest',
      preferred_node: nodes[0]?.node ?? 'pve1',
      nodelist: nodes.map((n, i) => ({
        name: n.node,
        nodeid: i + 1,
        pve_addr: `192.168.1.${10 + i}`,
        pve_fp: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
        quorum_votes: 1,
      })),
      totem: {
        cluster_name: mock.clusterConfig.clustername,
        config_version: 1,
      },
    }
  })

  on('POST', '/cluster/config/join', ({ input, mock, auth }) => {
    const hostname = str(input['hostname'])
    const node = mock.world.current.nodes[0]?.node ?? 'pve1'
    return runTask(mock, {
      node,
      type: 'clusterjoin',
      id: hostname,
      user: auth.username,
      onSuccess: () => {
        if (!mock.clusterConfig.nodes.includes(hostname)) {
          mock.clusterConfig.nodes.push(hostname)
        }
        mock.clusterConfig.created = true
      },
    })
  })

  on('GET', '/cluster/config/nodes', ({ mock }) =>
    mock.clusterConfig.nodes.map((node, i) => ({
      node,
      nodeid: i + 1,
      ring0_addr: `192.168.1.${10 + i}`,
      quorum_votes: 1,
    })),
  )

  on('DELETE', '/cluster/config/nodes/{node}', ({ input, mock }) => {
    const name = str(input['node'])
    mock.clusterConfig.nodes = mock.clusterConfig.nodes.filter((n) => n !== name)
    return null
  })

  on('GET', '/cluster/config/totem', ({ mock }) => ({
    cluster_name: mock.clusterConfig.clustername,
    config_version: 1,
    ip_version: 'ipv4',
    secauth: 'on',
  }))

  on('GET', '/cluster/config/apiversion', () => 2)
}

export function applyCephClusterHandlers(handlers: HandlerTable): void {
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[`${method} ${path}`] = handler
  }
  register(on)
}
