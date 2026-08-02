import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport } from '@pve/api'
import { FIXTURES } from './context.ts'
import { startMockServer } from './index.ts'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

let server: Awaited<ReturnType<typeof startMockServer>>
let client: PveClient

async function waitForTask(upid: string, timeoutMs = 15_000): Promise<void> {
  const node = upid.split(':')[1] ?? 'pve1'
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
    if (status.status === 'stopped') {
      expect(status.exitstatus).toBe('OK')
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`task ${upid} không xong`)
}

beforeEach(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)
  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
  client = new PveClient({ transport, auth, connectionId: 'phase7-full' })
})

afterEach(async () => {
  await server.close()
})

describe('phase 7 full', () => {
  it('đăng ký fixture broken-cluster', () => {
    expect(FIXTURES).toContain('broken-cluster')
  })

  it('disks list + SMART + initgpt', async () => {
    const disks = await client.request('GET', '/nodes/{node}/disks/list', { node: 'pve1' })
    expect(disks.length).toBeGreaterThan(0)
    const free = disks.find((d) => !d.used)
    expect(free?.devpath).toBeTruthy()

    const smart = await client.request('GET', '/nodes/{node}/disks/smart', {
      node: 'pve1',
      disk: String(free!.devpath),
    })
    expect(smart.health).toBeTruthy()

    const upid = await client.request('POST', '/nodes/{node}/disks/initgpt', {
      node: 'pve1',
      disk: String(free!.devpath),
    })
    await waitForTask(String(upid))
  })

  it('apt update + versions', async () => {
    const updates = await client.request('GET', '/nodes/{node}/apt/update', { node: 'pve1' })
    expect(updates.length).toBeGreaterThan(0)
    const upid = await client.request('POST', '/nodes/{node}/apt/update', { node: 'pve1' })
    await waitForTask(String(upid))
    const versions = await client.request('GET', '/nodes/{node}/apt/versions', { node: 'pve1' })
    expect(versions.some((p) => p.Package === 'pve-manager')).toBe(true)
  })

  it('certificates info + ACME order', async () => {
    const certs = await client.request('GET', '/nodes/{node}/certificates/info', { node: 'pve1' })
    expect(certs.length).toBeGreaterThan(0)
    const upid = await client.request('POST', '/nodes/{node}/certificates/acme/certificate', {
      node: 'pve1',
    })
    await waitForTask(String(upid))
  })

  it('syslog + journal', async () => {
    const syslog = await client.request('GET', '/nodes/{node}/syslog', {
      node: 'pve1',
      start: 0,
      limit: 10,
    })
    expect(syslog).toHaveLength(10)
    const journal = await client.request('GET', '/nodes/{node}/journal', {
      node: 'pve1',
      lastentries: 5,
    })
    expect(journal.length).toBe(5)
  })

  it('ceph status phản ánh broken-cluster', async () => {
    server.mock.loadFixture('broken-cluster')
    const status = await client.request('GET', '/cluster/ceph/status', {})
    expect(status.health?.status).toBe('HEALTH_WARN')
    const resources = await client.request('GET', '/cluster/resources', { type: 'node' })
    const pve3 = resources.find((r) => r.node === 'pve3')
    expect(pve3?.status).toBe('offline')
  })

  it('cluster config nodes + join', async () => {
    const nodes = await client.request('GET', '/cluster/config/nodes', {})
    expect(nodes.length).toBeGreaterThanOrEqual(1)
    const join = await client.request('GET', '/cluster/config/join', {})
    expect(join.preferred_node).toBeTruthy()
    const upid = await client.request('POST', '/cluster/config/join', {
      hostname: 'pve-new',
      password: 'x',
      fingerprint: 'AA:BB:CC',
    })
    await waitForTask(String(upid))
  })

  it('zfs create từ đĩa trống', async () => {
    const disks = await client.request('GET', '/nodes/{node}/disks/list', { node: 'pve1' })
    const free = disks.find((d) => !d.used)
    expect(free).toBeTruthy()
    const upid = await client.request('POST', '/nodes/{node}/disks/zfs', {
      node: 'pve1',
      name: 'tank-test',
      devices: String(free!.devpath),
      raidlevel: 'single',
    })
    await waitForTask(String(upid))
    const pools = await client.request('GET', '/nodes/{node}/disks/zfs', { node: 'pve1' })
    expect(pools.some((p) => p.name === 'tank-test')).toBe(true)
  })
})
