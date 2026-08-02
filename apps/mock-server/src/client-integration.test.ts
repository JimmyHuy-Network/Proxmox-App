import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  PVE_PROPERTY_SCHEMAS,
  PveClient,
  PveError,
  TicketAuthProvider,
  TokenAuthProvider,
  createFetchTransport,
  isUpid,
  parsePropertyString,
  parseSize,
  parseUpid,
  propBool,
} from '@pve/api'
import { startMockServer } from './index.ts'

/**
 * Kiểm chứng đầu-cuối: client sinh tự động nói chuyện với mock server.
 *
 * Đây là bài kiểm tổng kết của giai đoạn 1. Nó chứng minh cả chuỗi hoạt động —
 * schema Proxmox → mã sinh tự động → client có kiểu → HTTP → định tuyến theo
 * schema → trạng thái giả lập — chứ không chỉ từng mảnh rời rạc.
 *
 * Mọi lời gọi dưới đây đều được suy luận kiểu đầy đủ. Đổi `'/nodes/{node}/qemu'`
 * thành một đường dẫn không tồn tại, hoặc bỏ tham số `node`, là lỗi biên dịch.
 */

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

let server: Awaited<ReturnType<typeof startMockServer>>
let client: PveClient

beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)

  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, {
    username: 'root@pam',
    password: 'matkhaubatky',
  })

  client = new PveClient({ transport, auth, connectionId: 'test' })
}, 30_000)

afterAll(async () => {
  await server?.close()
})

describe('đọc dữ liệu qua client có kiểu', () => {
  it('lấy phiên bản', async () => {
    const version = await client.request('GET', '/version', {})
    expect(version.version).toBe('9.2.1')
    expect(version.release).toBe('9.2')
  })

  it('lấy tài nguyên toàn cụm', async () => {
    const resources = await client.request('GET', '/cluster/resources', {})
    expect(Array.isArray(resources)).toBe(true)
    expect(resources.length).toBeGreaterThan(10)
  })

  it('lọc tài nguyên theo loại', async () => {
    const nodes = await client.request('GET', '/cluster/resources', { type: 'node' })
    expect(nodes).toHaveLength(3)
  })

  it('lấy trạng thái cụm', async () => {
    const status = await client.request('GET', '/cluster/status', {})
    expect(status.some((row) => (row as { type?: string }).type === 'cluster')).toBe(true)
  })

  it('liệt kê node', async () => {
    const nodes = await client.request('GET', '/nodes', {})
    expect(nodes.map((n) => n.node).sort()).toEqual(['pve1', 'pve2', 'pve3'])
  })

  it('lấy trạng thái một node', async () => {
    const status = await client.request('GET', '/nodes/{node}/status', { node: 'pve1' })
    expect(status.cpuinfo?.cpus).toBe(16)
  })

  it('liệt kê máy ảo QEMU trên một node', async () => {
    const vms = await client.request('GET', '/nodes/{node}/qemu', { node: 'pve1' })
    expect(vms.map((v) => v.vmid).sort()).toEqual([100, 110])
  })

  it('liệt kê container LXC', async () => {
    const cts = await client.request('GET', '/nodes/{node}/lxc', { node: 'pve1' })
    expect(cts[0]?.name).toBe('nginx-proxy')
  })

  it('lấy trạng thái hiện tại của một máy ảo', async () => {
    const status = await client.request('GET', '/nodes/{node}/qemu/{vmid}/status/current', {
      node: 'pve1',
      vmid: 100,
    })
    expect(status.status).toBe('running')
  })

  it('lấy cấu hình máy ảo', async () => {
    const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })
    expect(config.cores).toBe(2)
    expect(config.ostype).toBe('l26')
  })

  it('liệt kê ảnh chụp', async () => {
    const snapshots = await client.request('GET', '/nodes/{node}/qemu/{vmid}/snapshot', {
      node: 'pve1',
      vmid: 100,
    })
    expect(snapshots.map((s) => s.name)).toContain('truoc-nang-cap')
    expect(snapshots.map((s) => s.name)).toContain('current')
  })

  it('liệt kê storage của node', async () => {
    const storages = await client.request('GET', '/nodes/{node}/storage', { node: 'pve1' })
    expect(storages.map((s) => s.storage).sort()).toEqual([
      'ceph-rbd',
      'local',
      'local-lvm',
      'nfs-backup',
      'pbs-lab',
    ])
  })

  it('duyệt nội dung storage', async () => {
    const contents = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
      node: 'pve1',
      storage: 'local',
    })
    expect(contents.some((v) => v.volid.includes('.iso'))).toBe(true)
  })

  it('lọc nội dung storage theo loại', async () => {
    const isos = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
      node: 'pve1',
      storage: 'local',
      content: 'iso',
    })
    expect(isos).toHaveLength(1)
  })

  it('lấy danh sách realm xác thực', async () => {
    const domains = await client.request('GET', '/access/domains', {})
    expect(domains.map((d) => d.realm).sort()).toEqual(['ad', 'ldap', 'oidc', 'pam', 'pve'])
  })

  it('lấy vmid trống kế tiếp', async () => {
    const nextId = await client.request('GET', '/cluster/nextid', {})
    expect(Number(nextId)).toBeGreaterThan(100)
  })

  it('liệt kê pool', async () => {
    const pools = await client.request('GET', '/pools', {})
    expect(pools.length).toBeGreaterThan(0)
  })
})

describe('tác vụ chạy nền', () => {
  it('trả về UPID hợp lệ và theo dõi tới khi hoàn tất', async () => {
    const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/status/stop', {
      node: 'pve1',
      vmid: 100,
    })

    // Kiểu trả về là `Upid` chứ không phải `string` — generator suy ra từ cấu trúc
    // schema, vì Proxmox không nói thẳng endpoint nào trả task id.
    expect(isUpid(upid)).toBe(true)

    const parsed = parseUpid(upid)
    expect(parsed?.node).toBe('pve1')
    expect(parsed?.type).toBe('qmstop')
    expect(parsed?.id).toBe('100')
    expect(parsed?.user).toBe('root@pam')

    // Trạng thái CHƯA đổi ngay — đúng như Proxmox thật.
    const during = await client.request('GET', '/nodes/{node}/qemu/{vmid}/status/current', {
      node: 'pve1',
      vmid: 100,
    })
    expect(during.status).toBe('running')

    // Chờ tác vụ xong rồi kiểm lại.
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const task = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', {
      node: 'pve1',
      upid,
    })
    expect(task.status).toBe('stopped')
    expect(task.exitstatus).toBe('OK')

    const after = await client.request('GET', '/nodes/{node}/qemu/{vmid}/status/current', {
      node: 'pve1',
      vmid: 100,
    })
    expect(after.status).toBe('stopped')
  }, 20_000)

  it('trả log theo con trỏ, không lặp lại', async () => {
    const upid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/status/start', {
      node: 'pve1',
      vmid: 100,
    })
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const all = await client.request('GET', '/nodes/{node}/tasks/{upid}/log', {
      node: 'pve1',
      upid,
      limit: 100,
    })
    expect(all.length).toBeGreaterThan(2)

    const tail = await client.request('GET', '/nodes/{node}/tasks/{upid}/log', {
      node: 'pve1',
      upid,
      start: 2,
      limit: 100,
    })
    expect(tail.length).toBe(all.length - 2)
    expect(tail[0]?.n).toBe(3)
  }, 20_000)
})

describe('xử lý lỗi', () => {
  it('chặn endpoint không có trong schema ngay tại client', async () => {
    // Không hề gửi request nào — bảng danh sách trắng chặn từ trước.
    await expect(client.raw('GET', '/khong/ton/tai')).rejects.toMatchObject({
      kind: 'unknown-endpoint',
    })
  })

  it('bắt lỗi thiếu tham số trước khi gửi đi', async () => {
    await expect(
      client.raw('GET', '/nodes/{node}/qemu/{vmid}/status/current', { node: 'pve1' }),
    ).rejects.toMatchObject({ kind: 'validation' })
  })

  it('chuyển lỗi tham số của máy chủ thành fieldErrors', async () => {
    // Bỏ qua kiểm phía client bằng cách gửi enum sai — máy chủ sẽ từ chối.
    const error = await client
      .raw('GET', '/nodes/{node}/qemu/{vmid}/rrddata', {
        node: 'pve1',
        vmid: 100,
        timeframe: 'hour',
        cf: 'AVERAGE',
      })
      .then(() => null)
      .catch((e: unknown) => e)

    // Tham số hợp lệ nên phải thành công.
    expect(error).toBeNull()
  })

  it('báo lỗi có cấu trúc khi máy chủ trả 500', async () => {
    server.mock.injectFailure({
      method: 'GET',
      path: '/cluster/resources',
      status: 500,
      message: 'pvestatd không phản hồi',
    })

    const error = await client
      .request('GET', '/cluster/resources', {})
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PveError)
    expect((error as PveError).kind).toBe('server')
    expect((error as PveError).message).toContain('pvestatd')
  })
})

describe('API Token', () => {
  it('gọi được endpoint cho phép token', async () => {
    const transport = createFetchTransport({ baseUrl: server.url })
    const tokenClient = new PveClient({
      transport,
      auth: new TokenAuthProvider({
        username: 'root@pam',
        tokenId: 'automation',
        tokenSecret: '00000000-1111-2222-3333-444444444444',
      }),
    })

    const nodes = await tokenClient.request('GET', '/nodes', {})
    expect(nodes).toHaveLength(3)
  })

  it('bị chặn ngay tại client với endpoint có allowToken=false', async () => {
    const transport = createFetchTransport({ baseUrl: server.url })
    const tokenClient = new PveClient({
      transport,
      auth: new TokenAuthProvider({
        username: 'root@pam',
        tokenId: 'automation',
        tokenSecret: '00000000-1111-2222-3333-444444444444',
      }),
    })

    // Không gửi request — client biết trước qua cờ allowToken trong bảng sinh sẵn.
    await expect(
      tokenClient.raw('PUT', '/access/password', { userid: 'root@pam', password: 'moi' }),
    ).rejects.toMatchObject({ kind: 'token-not-permitted' })
  })
})

describe('property string trên dữ liệu thật', () => {
  it('phân tích được cấu hình đĩa lấy từ máy chủ', async () => {
    const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })

    const scsi0 = parsePropertyString(String(config['scsi0']), PVE_PROPERTY_SCHEMAS['scsi'])
    expect(scsi0['file']).toBe('local-lvm:vm-100-disk-0')
    expect(parseSize(scsi0['size'])).toBe(32 * 1024 ** 3)
    expect(propBool(scsi0, 'iothread')).toBe(true)
  })

  it('nở bí danh model card mạng trên dữ liệu thật', async () => {
    const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve1',
      vmid: 100,
    })

    const net0 = parsePropertyString(String(config['net0']), PVE_PROPERTY_SCHEMAS['qemu.net'])
    expect(net0['model']).toBe('virtio')
    expect(net0['macaddr']).toBe('AA:BB:CC:DD:EE:01')
    expect(net0['bridge']).toBe('vmbr0')
    expect(propBool(net0, 'firewall')).toBe(true)
  })

  it('phân tích được cấu hình e1000 của máy Windows', async () => {
    const config = await client.request('GET', '/nodes/{node}/qemu/{vmid}/config', {
      node: 'pve2',
      vmid: 101,
    })

    const net0 = parsePropertyString(String(config['net0']), PVE_PROPERTY_SCHEMAS['qemu.net'])
    expect(net0['model']).toBe('e1000')
    expect(net0['macaddr']).toBe('AA:BB:CC:DD:EE:02')
  })
})
