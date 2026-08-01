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
    'clone từ snapshot ghi chú description',
    async () => {
      const newid = Number(await client.request('GET', '/cluster/nextid', {}))
      const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/clone', {
        node: 'pve1',
        vmid: 100,
        newid,
        name: 'from-snap',
        snapname: 'truoc-nang-cap',
      })
      await waitForTask('pve1', upid)
      const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
        node: 'pve1',
        vmid: newid,
      })
      expect(String(config['description'])).toContain('cloned-from-snapshot:truoc-nang-cap')
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

describe('template / move_disk / destroy', () => {
  it(
    'convert QEMU thành template (qmtemplate) và không cho start',
    async () => {
      // Dùng ubuntu-noble (102) — dừng trước rồi convert.
      const stop = await client.request('POST', '/nodes/{node}/qemu/{vmid}/status/stop', {
        node: 'pve3',
        vmid: 102,
      })
      await waitForTask('pve3', stop)

      const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/template', {
        node: 'pve3',
        vmid: 102,
      })
      expect(parseUpid(upid).type).toBe('qmtemplate')
      await waitForTask('pve3', upid)

      const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
        node: 'pve3',
        vmid: 102,
      })
      expect(config['template']).toBe(1)
      expect(String(config['scsi0'])).toContain(':base-')

      await expect(
        client.request('POST', '/nodes/{node}/qemu/{vmid}/status/start', {
          node: 'pve3',
          vmid: 102,
        }),
      ).rejects.toThrow(/template/i)
    },
    20_000,
  )

  it(
    'convert LXC template đồng bộ (null)',
    async () => {
      const stop = await client.request('POST', '/nodes/{node}/lxc/{vmid}/status/stop', {
        node: 'pve1',
        vmid: 200,
      })
      await waitForTask('pve1', stop)

      const result = await client.request('POST', '/nodes/{node}/lxc/{vmid}/template', {
        node: 'pve1',
        vmid: 200,
      })
      expect(result).toBeNull()

      const config = await client.request('GET', '/nodes/{node}/lxc/{vmid}/config', {
        node: 'pve1',
        vmid: 200,
      })
      expect(config['template']).toBe(1)
    },
    20_000,
  )

  it(
    'move_disk đổi storage và giữ unused khi delete=0',
    async () => {
      const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/move_disk', {
        node: 'pve1',
        vmid: 100,
        disk: 'scsi0',
        storage: 'ceph-rbd',
        delete: 0,
      })
      expect(parseUpid(upid).type).toBe('qmmove')
      await waitForTask('pve1', upid)

      const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
        node: 'pve1',
        vmid: 100,
      })
      expect(String(config['scsi0'])).toMatch(/^ceph-rbd:/)
      expect(config['unused0']).toBeTruthy()
    },
    20_000,
  )

  it(
    'destroy xóa guest khỏi world',
    async () => {
      const newid = Number(await client.request('GET', '/cluster/nextid', {}))
      const create = await client.request('POST', '/nodes/{node}/qemu', {
        node: 'pve1',
        vmid: newid,
        name: 'to-destroy',
        cores: 1,
        memory: '512',
        scsi0: 'local-lvm:4',
      })
      await waitForTask('pve1', create)

      const upid = await client.request('DELETE', '/nodes/{node}/qemu/{vmid}', {
        node: 'pve1',
        vmid: newid,
      })
      expect(parseUpid(upid).type).toBe('qmdestroy')
      await waitForTask('pve1', upid)

      const list = await client.request('GET', '/nodes/{node}/qemu', { node: 'pve1' })
      expect(list.some((g) => g.vmid === newid)).toBe(false)
    },
    20_000,
  )
})

describe('ACL / tasks filter', () => {
  it('GET /access/acl trả seed + PUT thêm/xóa theo path guest', async () => {
    const before = await client.request('GET', '/access/acl', {})
    expect(before.some((a) => a.path === '/vms/100')).toBe(true)

    await client.request('PUT', '/access/acl', {
      path: '/vms/100',
      users: 'alice@pam',
      roles: 'PVEVMUser',
      propagate: 1,
    })
    const mid = await client.request('GET', '/access/acl', {})
    expect(mid.some((a) => a.path === '/vms/100' && a.ugid === 'alice@pam' && a.roleid === 'PVEVMUser')).toBe(
      true,
    )

    await client.request('PUT', '/access/acl', {
      path: '/vms/100',
      users: 'alice@pam',
      roles: 'PVEVMUser',
      delete: 1,
    })
    const after = await client.request('GET', '/access/acl', {})
    expect(after.some((a) => a.ugid === 'alice@pam' && a.path === '/vms/100')).toBe(false)
  })

  it('GET /nodes/{node}/tasks?vmid= lọc theo guest', async () => {
    const all = await client.request('GET', '/nodes/{node}/tasks', {
      node: 'pve1',
      source: 'all',
      limit: 100,
    })
    const for100 = await client.request('GET', '/nodes/{node}/tasks', {
      node: 'pve1',
      vmid: 100,
      source: 'all',
      limit: 100,
    })
    expect(for100.every((t) => t.id === '100')).toBe(true)
    expect(for100.length).toBeLessThanOrEqual(all.length)
  })
})
