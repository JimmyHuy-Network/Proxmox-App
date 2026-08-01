import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport, isUpid, parseUpid } from '@pve/api'
import { startMockServer } from './index.ts'

/**
 * POST tạo VM phải ghi guest vào world sau khi task `qmcreate` xong — nếu chỉ
 * auto-faker thì wizard UI tạo được “thành công” nhưng cây tài nguyên không đổi.
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

async function waitForTask(node: string, upid: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const status = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
    if (status.status === 'stopped') return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Task ${upid} không xong sau 5 giây`)
}

describe('POST /nodes/{node}/qemu (tạo VM)', () => {
  it('trả UPID qmcreate và guest xuất hiện sau khi task xong', async () => {
    const nextId = await client.request('GET', '/cluster/nextid', {})
    const vmid = Number(nextId)
    expect(vmid).toBeGreaterThanOrEqual(100)

    const upid = await client.request('POST', '/nodes/{node}/qemu', {
      node: 'pve1',
      vmid,
      name: 'wizard-test',
      cores: 2,
      sockets: 1,
      memory: '2048',
      ostype: 'l26',
      scsihw: 'virtio-scsi-single',
      scsi0: 'local-lvm:16',
      net0: 'virtio=AA:BB:CC:DD:00:01,bridge=vmbr0,firewall=1',
    })

    expect(isUpid(upid)).toBe(true)
    expect(parseUpid(upid).type).toBe('qmcreate')

    // Trong lúc task chạy, guest chưa có trong danh sách.
    const during = await client.request('GET', '/nodes/{node}/qemu', { node: 'pve1' })
    expect(during.some((g) => g.vmid === vmid)).toBe(false)

    await waitForTask('pve1', upid)

    const list = await client.request('GET', '/nodes/{node}/qemu', { node: 'pve1' })
    const created = list.find((g) => g.vmid === vmid)
    expect(created?.name).toBe('wizard-test')
    expect(created?.status).toBe('stopped')
    expect(created?.cpus).toBe(2)
    expect(created?.maxmem).toBe(2048 * 1024 * 1024)

    const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid,
    })
    expect(config['name']).toBe('wizard-test')
    expect(config['scsi0']).toBe('local-lvm:16')
    expect(String(config['net0'])).toContain('bridge=vmbr0')

    const resources = await client.request('GET', '/cluster/resources', { type: 'vm' })
    expect(resources.some((r) => r['vmid'] === vmid && r['type'] === 'qemu')).toBe(true)
  })

  it('từ chối vmid trùng', async () => {
    await expect(
      client.request('POST', '/nodes/{node}/qemu', {
        node: 'pve1',
        vmid: 100,
        name: 'dup',
        memory: '512',
      }),
    ).rejects.toThrow(/already exists/)
  })
})
