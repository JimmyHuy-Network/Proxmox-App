import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport } from '@pve/api'
import { startMockServer } from './index.ts'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

let server: Awaited<ReturnType<typeof startMockServer>>

async function clientAs(username: string, password = 'x'): Promise<PveClient> {
  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, { username, password })
  return new PveClient({ transport, auth, connectionId: `phase8-${username}` })
}

beforeEach(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)
})

afterEach(async () => {
  await server.close()
})

describe('phase 8 — access / cap', () => {
  it('root có VM.PowerMgmt; vanhanh (auditor) không', async () => {
    const root = await clientAs('root@pam')
    const ticket = await root.request('GET', '/access/permissions', {})
    expect(ticket['/']?.['VM.PowerMgmt']).toBe(1)

    const auditor = await clientAs('vanhanh@pve')
    const perms = await auditor.request('GET', '/access/permissions', {})
    expect(perms['/']?.['VM.Audit']).toBe(1)
    expect(perms['/']?.['VM.PowerMgmt']).toBeUndefined()
    expect(perms['/']?.['Permissions.Modify']).toBeUndefined()
  })

  it('vanhanh bị 403 khi start VM', async () => {
    const auditor = await clientAs('vanhanh@pve')
    await expect(
      auditor.request('POST', '/nodes/{node}/qemu/{vmid}/status/start', { node: 'pve1', vmid: 100 }),
    ).rejects.toThrow(/Permission|403|failed/i)
  })

  it('CRUD user / group / role / ACL / pool', async () => {
    const client = await clientAs('root@pam')
    await client.request('POST', '/access/users', { userid: 'demo@pve', comment: 'demo' })
    const users = await client.request('GET', '/access/users', {})
    expect(users.some((u) => u.userid === 'demo@pve')).toBe(true)

    await client.request('POST', '/access/groups', { groupid: 'qa', comment: 'QA' })
    const groups = await client.request('GET', '/access/groups', {})
    expect(groups.some((g) => g.groupid === 'qa')).toBe(true)

    await client.request('POST', '/access/roles', { roleid: 'QARole', privs: 'VM.Audit' })
    const roles = await client.request('GET', '/access/roles', {})
    expect(roles.some((r) => r.roleid === 'QARole')).toBe(true)

    await client.request('PUT', '/access/acl', {
      path: '/vms/100',
      users: 'demo@pve',
      roles: 'PVEVMUser',
      propagate: 1,
    })
    const acl = await client.request('GET', '/access/acl', {})
    expect(acl.some((a) => a.ugid === 'demo@pve' && a.path === '/vms/100')).toBe(true)

    await client.request('POST', '/pools', { poolid: 'staging', comment: 'stg' })
    const pools = await client.request('GET', '/pools', {})
    expect(pools.some((p) => p.poolid === 'staging')).toBe(true)
  })

  it('API token create trả secret', async () => {
    const client = await clientAs('root@pam')
    const res = await client.request('POST', '/access/users/{userid}/token/{tokenid}', {
      userid: 'root@pam',
      tokenid: 'ci',
      comment: 'test',
    })
    expect(res.value).toBeTruthy()
    expect(res.full_tokenid).toBe('root@pam!ci')
  })
})

describe('phase 8 — firewall', () => {
  it('cluster rules + reorder moveto', async () => {
    const client = await clientAs('root@pam')
    const before = await client.request('GET', '/cluster/firewall/rules', {})
    expect(before.length).toBeGreaterThanOrEqual(2)
    const first = before[0]!.action

    await client.request('PUT', '/cluster/firewall/rules/{pos}', { pos: 0, moveto: 1 })
    const after = await client.request('GET', '/cluster/firewall/rules', {})
    expect(after[1]?.action).toBe(first)

    const pos = await client.request('POST', '/cluster/firewall/rules', {
      action: 'DROP',
      type: 'in',
      proto: 'tcp',
      dport: '3389',
      enable: 1,
      comment: 'RDP block',
    })
    expect(typeof pos === 'number' || typeof pos === 'string').toBe(true)
  })

  it('alias + ipset + security group', async () => {
    const client = await clientAs('root@pam')
    await client.request('POST', '/cluster/firewall/aliases', {
      name: 'dmz',
      cidr: '172.16.0.0/12',
    })
    const aliases = await client.request('GET', '/cluster/firewall/aliases', {})
    expect(aliases.some((a) => a.name === 'dmz')).toBe(true)

    await client.request('POST', '/cluster/firewall/ipset', { name: 'allowlist' })
    await client.request('POST', '/cluster/firewall/ipset/{name}', {
      name: 'allowlist',
      cidr: '10.0.0.0/8',
    })
    const entries = await client.request('GET', '/cluster/firewall/ipset/{name}', { name: 'allowlist' })
    expect(entries.some((e) => e.cidr === '10.0.0.0/8')).toBe(true)

    await client.request('POST', '/cluster/firewall/groups', { group: 'db', comment: 'DB' })
    await client.request('POST', '/cluster/firewall/groups/{group}', {
      group: 'db',
      action: 'ACCEPT',
      type: 'in',
      proto: 'tcp',
      dport: '5432',
      enable: 1,
    })
    const rules = await client.request('GET', '/cluster/firewall/groups/{group}', { group: 'db' })
    expect(rules.length).toBeGreaterThanOrEqual(1)
  })

  it('guest firewall rules', async () => {
    const client = await clientAs('root@pam')
    const rules = await client.request('GET', '/nodes/{node}/qemu/{vmid}/firewall/rules', {
      node: 'pve1',
      vmid: 100,
    })
    expect(Array.isArray(rules)).toBe(true)
  })
})

describe('phase 8 — SDN / HA / replication / notify / metrics', () => {
  it('SDN zones/vnets + apply', async () => {
    const client = await clientAs('root@pam')
    const zones = await client.request('GET', '/cluster/sdn/zones', {})
    expect(zones.length).toBeGreaterThanOrEqual(1)
    await client.request('POST', '/cluster/sdn/zones', { zone: 'testzone', type: 'simple' })
    const upid = await client.request('PUT', '/cluster/sdn', {})
    expect(String(upid)).toMatch(/^UPID:/)
  })

  it('HA groups/resources/status', async () => {
    const client = await clientAs('root@pam')
    const groups = await client.request('GET', '/cluster/ha/groups', {})
    expect(groups.some((g) => g.group === 'ha-preferred')).toBe(true)
    const status = await client.request('GET', '/cluster/ha/status/current', {})
    expect(status.length).toBeGreaterThan(0)
    await client.request('POST', '/cluster/ha/resources', { sid: 'vm:200', group: 'ha-preferred' })
  })

  it('replication list + schedule_now', async () => {
    const client = await clientAs('root@pam')
    const jobs = await client.request('GET', '/cluster/replication', {})
    expect(jobs.length).toBeGreaterThanOrEqual(1)
    const upid = await client.request('POST', '/nodes/{node}/replication/{id}/schedule_now', {
      node: 'pve1',
      id: jobs[0]!.id,
    })
    expect(String(upid)).toMatch(/^UPID:/)
  })

  it('notification targets + metric servers', async () => {
    const client = await clientAs('root@pam')
    const targets = await client.request('GET', '/cluster/notifications/targets', {})
    expect(targets.length).toBeGreaterThanOrEqual(1)
    const metrics = await client.request('GET', '/cluster/metrics/server', {})
    expect(metrics.some((m) => m.id === 'influx')).toBe(true)
  })

  it('vanhanh không tạo được SDN zone', async () => {
    const auditor = await clientAs('vanhanh@pve')
    await expect(
      auditor.request('POST', '/cluster/sdn/zones', { zone: 'nope', type: 'simple' }),
    ).rejects.toThrow(/Permission|403|failed/i)
  })
})
