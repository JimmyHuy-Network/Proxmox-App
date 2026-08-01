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
  for (let i = 0; i < 120; i += 1) {
    const status = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
    if (status.status === 'stopped') return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Task ${upid} không xong`)
}

describe('clone / migrate / resize', () => {
  it(
    'clone QEMU tạo guest mới với newid',
    async () => {
      const newid = Number(await client.request('GET', '/cluster/nextid', {}))
      const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/clone', {
        node: 'pve1',
        vmid: 100,
        newid,
        name: 'debian-clone',
      })
      expect(isUpid(upid)).toBe(true)
      expect(parseUpid(upid).type).toBe('qmclone')
      await waitForTask('pve1', upid)

      const list = await client.request('GET', '/nodes/{node}/qemu', { node: 'pve1' })
      expect(list.some((g) => g.vmid === newid && g.name === 'debian-clone')).toBe(true)
    },
    20_000,
  )

  it(
    'migrate chuyển node của guest',
    async () => {
      const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/migrate', {
        node: 'pve2',
        vmid: 101,
        target: 'pve3',
      })
      expect(parseUpid(upid).type).toBe('qmigrate')
      await waitForTask('pve2', upid)

      const resources = await client.request('GET', '/cluster/resources', { type: 'vm' })
      const row = resources.find((r) => r['vmid'] === 101)
      expect(row?.['node']).toBe('pve3')
    },
    20_000,
  )

  it('resize cập nhật size trên config đĩa', async () => {
    const before = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })
    expect(String(before['scsi0'])).toContain('size=32G')

    const upid = await client.request('PUT', '/nodes/{node}/qemu/{vmid}/resize', {
      node: 'pve1',
      vmid: 100,
      disk: 'scsi0',
      size: '+8G',
    })
    expect(parseUpid(upid).type).toBe('qmresize')
    await waitForTask('pve1', upid)

    const after = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })
    expect(String(after['scsi0'])).toContain('size=40G')
  })
})
