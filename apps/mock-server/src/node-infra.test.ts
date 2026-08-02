import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport } from '@pve/api'
import { startMockServer } from './index.ts'

/**
 * Hạ tầng node GĐ 7: network pending/apply/revert, DNS, hosts, time.
 */

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
  throw new Error(`task ${upid} không xong trong ${timeoutMs}ms`)
}

beforeEach(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)
  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
  client = new PveClient({ transport, auth, connectionId: 'node-infra-test' })
})

afterEach(async () => {
  await server.close()
})

describe('node infra', () => {
  it('liệt kê network seed (eth0 + vmbr0)', async () => {
    const list = await client.request('GET', '/nodes/{node}/network', { node: 'pve1' })
    const names = list.map((i) => i.iface)
    expect(names).toContain('eth0')
    expect(names).toContain('vmbr0')
  })

  it('tạo bridge → pending → apply → revert hoạt động', async () => {
    await client.request('POST', '/nodes/{node}/network', {
      node: 'pve1',
      iface: 'vmbr9',
      type: 'bridge',
      bridge_ports: 'eth0',
      address: '10.9.9.1',
      netmask: '255.255.255.0',
    })
    let list = await client.request('GET', '/nodes/{node}/network', { node: 'pve1' })
    expect(list.some((i) => i.iface === 'vmbr9')).toBe(true)

    const upid = await client.request('PUT', '/nodes/{node}/network', { node: 'pve1' })
    expect(typeof upid).toBe('string')
    await waitForTask(String(upid))

    await client.request('POST', '/nodes/{node}/network', {
      node: 'pve1',
      iface: 'vmbr8',
      type: 'bridge',
    })
    list = await client.request('GET', '/nodes/{node}/network', { node: 'pve1' })
    expect(list.some((i) => i.iface === 'vmbr8')).toBe(true)

    await client.request('DELETE', '/nodes/{node}/network', { node: 'pve1' })
    list = await client.request('GET', '/nodes/{node}/network', { node: 'pve1' })
    expect(list.some((i) => i.iface === 'vmbr8')).toBe(false)
    expect(list.some((i) => i.iface === 'vmbr9')).toBe(true)
  })

  it('DNS / hosts / time đọc ghi được', async () => {
    const dns = await client.request('GET', '/nodes/{node}/dns', { node: 'pve1' })
    expect(dns.search).toBeTruthy()

    await client.request('PUT', '/nodes/{node}/dns', {
      node: 'pve1',
      search: 'example.test',
      dns1: '8.8.8.8',
    })
    const dns2 = await client.request('GET', '/nodes/{node}/dns', { node: 'pve1' })
    expect(dns2.search).toBe('example.test')
    expect(dns2.dns1).toBe('8.8.8.8')

    const hosts = await client.request('GET', '/nodes/{node}/hosts', { node: 'pve1' })
    expect(hosts.data).toContain('pve1')
    await client.request('POST', '/nodes/{node}/hosts', {
      node: 'pve1',
      data: '127.0.0.1 localhost\n10.0.0.1 pve1\n',
    })
    const hosts2 = await client.request('GET', '/nodes/{node}/hosts', { node: 'pve1' })
    expect(hosts2.data).toContain('10.0.0.1')

    const time = await client.request('GET', '/nodes/{node}/time', { node: 'pve1' })
    expect(time.timezone).toBeTruthy()
    await client.request('PUT', '/nodes/{node}/time', { node: 'pve1', timezone: 'UTC' })
    const time2 = await client.request('GET', '/nodes/{node}/time', { node: 'pve1' })
    expect(time2.timezone).toBe('UTC')
  })

  it('xóa interface đặt pending rồi revert khôi phục', async () => {
    await client.request('DELETE', '/nodes/{node}/network/{iface}', { node: 'pve1', iface: 'vmbr0' })
    let list = await client.request('GET', '/nodes/{node}/network', { node: 'pve1' })
    expect(list.some((i) => i.iface === 'vmbr0')).toBe(false)

    await client.request('DELETE', '/nodes/{node}/network', { node: 'pve1' })
    list = await client.request('GET', '/nodes/{node}/network', { node: 'pve1' })
    expect(list.some((i) => i.iface === 'vmbr0')).toBe(true)
  })
})
