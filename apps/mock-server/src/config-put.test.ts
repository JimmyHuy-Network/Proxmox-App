import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport } from '@pve/api'
import { startMockServer } from './index.ts'

/**
 * PUT config phải ghi vào world thật (không chỉ auto-faker) — đây là nền tảng
 * của tab Hardware editable: đổi net/cpu/memory và xóa thiết bị qua `delete=`.
 */

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

let server: Awaited<ReturnType<typeof startMockServer>>
let client: PveClient

beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)

  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
  client = new PveClient({ transport, auth, connectionId: 'test' })
}, 30_000)

afterAll(async () => {
  await server?.close()
})

describe('PUT guest config', () => {
  it('đổi net0 và đọc lại đúng property string', async () => {
    await client.request('PUT', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
      net0: 'virtio=11:22:33:44:55:66,bridge=vmbr1,firewall=0',
    })

    const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })
    expect(String(config['net0'])).toContain('bridge=vmbr1')
    expect(String(config['net0'])).toContain('11:22:33:44:55:66')
  })

  it('delete=net1 gỡ khóa; sync cpus/maxmem khi đổi cores/memory', async () => {
    await client.request('PUT', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
      net1: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
    })

    let config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })
    expect(config['net1']).toBeDefined()

    await client.request('PUT', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
      delete: 'net1',
      cores: 4,
      sockets: 2,
      // Schema QEMU khai báo memory là chuỗi (không phải integer như LXC).
      memory: '4096',
    })

    config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })
    expect(config['net1']).toBeUndefined()
    expect(config['cores']).toBe(4)
    expect(String(config['memory'])).toBe('4096')

    const status = await client.request('GET', '/nodes/{node}/qemu/{vmid}/status/current', {
      node: 'pve1',
      vmid: 100,
    })
    expect(status.cpus).toBe(8)
    expect(status.maxmem).toBe(4096 * 1024 * 1024)

    const resources = await client.request('GET', '/cluster/resources', { type: 'vm' })
    const row = resources.find((r) => r['vmid'] === 100)
    expect(row?.['maxcpu']).toBe(8)
    expect(row?.['maxmem']).toBe(4096 * 1024 * 1024)
  })
})
