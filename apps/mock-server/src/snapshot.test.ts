import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport, isUpid, parseUpid } from '@pve/api'
import { startMockServer } from './index.ts'

/**
 * Test hành vi snapshot LXC/QEMU mới thêm — bù cho khoảng trống mà đối chiếu với
 * PVE 9.2.2 thật đã phát hiện: trước bản sửa này, POST/DELETE snapshot rơi vào
 * auto-faker và không trả về chuỗi có hình dạng UPID, nên client không track được.
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

/**
 * `onSuccess` của task (ví dụ đẩy snapshot vào danh sách) chỉ chạy khi task engine
 * tick tới bước `done` — không phải ngay khi request trả về UPID. Test nào phụ
 * thuộc kết quả của một task phải đợi nó xong trước, giống hệt renderer thật phải
 * đợi qua `TaskButton`/`useTask` chứ không giả định xong ngay lập tức.
 */
async function waitForTask(node: string, upid: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const status = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
    if (status.status === 'stopped') return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Task ${upid} không xong sau 5 giây`)
}

describe('snapshot LXC', () => {
  it('tạo snapshot trả về UPID với type vzsnapshot, đúng như PVE thật', async () => {
    const upid = await client.request('POST', '/nodes/{node}/lxc/{vmid}/snapshot', {
      node: 'pve1',
      vmid: 200,
      snapname: 'test-ct',
    })

    expect(isUpid(upid)).toBe(true)
    expect(parseUpid(upid)?.type).toBe('vzsnapshot')
    await waitForTask('pve1', upid)

    const snapshots = await client.request('GET', '/nodes/{node}/lxc/{vmid}/snapshot', {
      node: 'pve1',
      vmid: 200,
    })
    expect(snapshots.map((s) => s.name)).toContain('test-ct')
  })

  it('xóa snapshot trả về UPID với type vzdelsnapshot', async () => {
    const createUpid = await client.request('POST', '/nodes/{node}/lxc/{vmid}/snapshot', {
      node: 'pve1',
      vmid: 200,
      snapname: 'de-xoa',
    })
    await waitForTask('pve1', createUpid)

    const upid = await client.request('DELETE', '/nodes/{node}/lxc/{vmid}/snapshot/{snapname}', {
      node: 'pve1',
      vmid: 200,
      snapname: 'de-xoa',
    })

    expect(isUpid(upid)).toBe(true)
    expect(parseUpid(upid)?.type).toBe('vzdelsnapshot')
    await waitForTask('pve1', upid)

    const snapshots = await client.request('GET', '/nodes/{node}/lxc/{vmid}/snapshot', {
      node: 'pve1',
      vmid: 200,
    })
    expect(snapshots.map((s) => s.name)).not.toContain('de-xoa')
  })

  it('từ chối tạo snapshot trùng tên', async () => {
    // CT 201 (postgres-db) nằm trên pve2 theo fixture, không phải pve1.
    const upid = await client.request('POST', '/nodes/{node}/lxc/{vmid}/snapshot', {
      node: 'pve2',
      vmid: 201,
      snapname: 'trung',
    })
    await waitForTask('pve2', upid)

    await expect(
      client.request('POST', '/nodes/{node}/lxc/{vmid}/snapshot', {
        node: 'pve2',
        vmid: 201,
        snapname: 'trung',
      }),
    ).rejects.toThrow(/already exists/)
  })
})

describe('snapshot QEMU', () => {
  it('tạo và xóa dùng type qmsnapshot/qmdelsnapshot, khác hẳn LXC', async () => {
    const createUpid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/snapshot', {
      node: 'pve1',
      vmid: 100,
      snapname: 'test-vm',
    })
    expect(parseUpid(createUpid)?.type).toBe('qmsnapshot')
    await waitForTask('pve1', createUpid)

    const deleteUpid = await client.request('DELETE', '/nodes/{node}/qemu/{vmid}/snapshot/{snapname}', {
      node: 'pve1',
      vmid: 100,
      snapname: 'test-vm',
    })
    expect(parseUpid(deleteUpid)?.type).toBe('qmdelsnapshot')
  })
})

describe('rollback', () => {
  it('trả về UPID với type rollback đúng theo loại guest', async () => {
    const createUpid = await client.request('POST', '/nodes/{node}/lxc/{vmid}/snapshot', {
      node: 'pve1',
      vmid: 200,
      snapname: 'cho-rollback',
    })
    await waitForTask('pve1', createUpid)

    const upid = await client.request('POST', '/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/rollback', {
      node: 'pve1',
      vmid: 200,
      snapname: 'cho-rollback',
    })
    expect(parseUpid(upid)?.type).toBe('vzrollback')
  })

  it('từ chối rollback về snapshot không tồn tại', async () => {
    await expect(
      client.request('POST', '/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/rollback', {
        node: 'pve1',
        vmid: 200,
        snapname: 'khong-ton-tai',
      }),
    ).rejects.toThrow(/does not exist/)
  })
})

describe('rrddata', () => {
  it('trả về chuỗi thời gian thật, không phải 3 điểm ngẫu nhiên của auto-faker', async () => {
    const points = await client.request('GET', '/nodes/{node}/qemu/{vmid}/rrddata', {
      node: 'pve1',
      vmid: 100,
      timeframe: 'hour',
    })
    expect(points.length).toBe(70)
  })

  it('có endpoint rrddata cho node, không chỉ guest', async () => {
    const points = await client.request('GET', '/nodes/{node}/rrddata', {
      node: 'pve1',
      timeframe: 'day',
    })
    expect(points.length).toBe(70)
  })
})
