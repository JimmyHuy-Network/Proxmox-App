import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport, isUpid, parseUpid } from '@pve/api'
import { startMockServer } from './index.ts'

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

describe('POST /nodes/{node}/lxc (tạo CT)', () => {
  it('trả UPID vzcreate và CT xuất hiện sau khi task xong', async () => {
    const nextId = await client.request('GET', '/cluster/nextid', {})
    const vmid = Number(nextId)

    const upid = await client.request('POST', '/nodes/{node}/lxc', {
      node: 'pve1',
      vmid,
      ostemplate: 'local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst',
      hostname: 'wizard-ct',
      cores: 1,
      memory: 512,
      swap: 512,
      ostype: 'debian',
      rootfs: 'local-lvm:8',
      net0: 'name=eth0,bridge=vmbr0,ip=dhcp',
      unprivileged: true,
      password: 'secret',
    })

    expect(isUpid(upid)).toBe(true)
    expect(parseUpid(upid).type).toBe('vzcreate')

    await waitForTask('pve1', upid)

    const list = await client.request('GET', '/nodes/{node}/lxc', { node: 'pve1' })
    const created = list.find((g) => g.vmid === vmid)
    expect(created?.name).toBe('wizard-ct')
    expect(created?.status).toBe('stopped')
    expect(created?.cpus).toBe(1)
    expect(created?.maxmem).toBe(512 * 1024 * 1024)

    const config = await client.request('GET', '/nodes/{node}/lxc/{vmid}/config', {
      node: 'pve1',
      vmid,
    })
    expect(config['hostname']).toBe('wizard-ct')
    expect(config['rootfs']).toBe('local-lvm:8')
    expect(config['ostemplate']).toBeUndefined()
    expect(config['password']).toBeUndefined()
    expect(String(config['net0'])).toContain('bridge=vmbr0')
  })

  it('từ chối khi thiếu ostemplate', async () => {
    await expect(
      client.request('POST', '/nodes/{node}/lxc', {
        node: 'pve1',
        vmid: 999,
        hostname: 'no-template',
      }),
    ).rejects.toThrow(/ostemplate/)
  })
})
