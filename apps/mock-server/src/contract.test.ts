import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { iterateEndpoints, loadSchema } from '@pve/schema'
import type { PveParamSpec, PveReturnSpec } from '@pve/schema'
import { startMockServer } from './index.ts'

/**
 * Contract test: duyệt toàn bộ schema và khẳng định mock trả lời đúng hình dạng
 * `returns` cho mọi route đã đăng ký.
 *
 * Đây là thứ biến việc định tuyến theo schema từ một ý tưởng hay thành một bảo đảm
 * kiểm chứng được. Nó cũng là hàng rào bắt lỗi khi Proxmox đổi schema: nếu bản
 * `apidoc.js` mới có endpoint mà mock không phục vụ nổi, test này báo ngay.
 */

// Node chạy với chứng chỉ tự ký của mock; tắt kiểm chứng chỉ CHỈ trong phạm vi test.
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

const schema = loadSchema()

let server: Awaited<ReturnType<typeof startMockServer>>
let baseUrl: string
let cookie: string
let csrfToken: string
/** UPID của một tác vụ có thật, để kiểm các endpoint tra cứu tác vụ. */
let liveUpid: string

beforeAll(async () => {
  // Cổng 0 để hệ điều hành cấp cổng trống — test chạy song song không đụng nhau.
  server = await startMockServer({ port: 0, quiet: true })
  baseUrl = server.url

  const response = await fetch(`${baseUrl}/api2/json/access/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'root@pam', password: 'matkhaubatky' }),
  })
  const { data } = (await response.json()) as {
    data: { ticket: string; CSRFPreventionToken: string }
  }

  // Ticket chứa dấu hai chấm và dấu bằng — không mã hoá URL là lỗi 401 kinh điển.
  cookie = `PVEAuthCookie=${encodeURIComponent(data.ticket)}`
  csrfToken = data.CSRFPreventionToken

  // Tạo một tác vụ thật để các endpoint /tasks/{upid}/… có cái mà tra. Dùng UPID
  // bịa ra thì mock trả 500 — và trả 500 mới là hành vi đúng, Proxmox thật cũng vậy.
  const taskResponse = await fetch(`${baseUrl}/api2/json/nodes/pve1/qemu/100/status/reboot`, {
    method: 'POST',
    headers: { Cookie: cookie, CSRFPreventionToken: csrfToken },
  })
  liveUpid = ((await taskResponse.json()) as { data: string }).data
}, 30_000)

afterAll(async () => {
  await server?.close()
})

/**
 * Sinh giá trị hợp lý cho một tham số bắt buộc.
 *
 * Dùng đúng dữ liệu có thật trong fixture ở những chỗ quan trọng (node, vmid,
 * storage), vì gọi bằng giá trị bịa sẽ nhận về lỗi "không tồn tại" và chẳng
 * kiểm chứng được gì.
 */
function valueForParam(name: string, spec: PveParamSpec, path: string): string {
  if (spec.enum && spec.enum.length > 0) return spec.enum[0] as string

  switch (name) {
    case 'node':
      return 'pve1'
    case 'vmid':
      // vmid 100 là QEMU, 200 là LXC — dùng nhầm sẽ nhận lỗi không tìm thấy.
      return path.includes('/lxc') ? '200' : '100'
    case 'storage':
      return 'local'
    case 'userid':
      return 'root@pam'
    case 'realm':
      return 'pam'
    case 'upid':
      return liveUpid
    case 'poolid':
      return 'production'
    case 'volume':
      // Volid có sẵn trong fixture local.
      return 'local:iso/debian-13.0.0-amd64-netinst.iso'
    case 'id':
      // Backup job seed trong cluster-3node.
      if (path.includes('/cluster/backup')) return 'backup-nightly'
      break
    default:
      break
  }

  const format = typeof spec.format === 'string' ? spec.format : ''
  if (format === 'pve-node') return 'pve1'
  if (format === 'pve-storage-id') return 'local'
  if (format === 'pve-vmid') return '100'
  if (format === 'pve-userid') return 'root@pam'

  switch (spec.type) {
    case 'integer':
      return String(spec.minimum ?? 1)
    case 'number':
      return String(spec.minimum ?? 1)
    case 'boolean':
      return '0'
    default:
      return 'test'
  }
}

function buildUrl(path: string, params: Record<string, PveParamSpec>): string {
  const query = new URLSearchParams()

  const pathname = path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const spec = params[name] ?? { type: 'string' }
    return encodeURIComponent(valueForParam(name, spec, path))
  })

  for (const [name, spec] of Object.entries(params)) {
    if (spec.optional) continue
    if (path.includes(`{${name}}`)) continue
    if (name.endsWith('[n]')) continue
    query.set(name, valueForParam(name, spec, path))
  }

  const suffix = query.toString()
  return `${baseUrl}/api2/json${pathname}${suffix ? `?${suffix}` : ''}`
}

/** Kiểm giá trị có khớp kiểu mà `returns` khai báo không. */
function conformsToReturns(value: unknown, spec: PveReturnSpec | undefined): boolean {
  if (!spec || spec.type === undefined) return true

  switch (spec.type) {
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'integer':
    case 'number':
      // Proxmox trả số dưới dạng chuỗi ở khá nhiều chỗ; chấp nhận cả hai.
      return typeof value === 'number' || (typeof value === 'string' && value !== '')
    case 'boolean':
      return typeof value === 'boolean' || value === 0 || value === 1
    case 'null':
      return value === null || value === undefined
    default:
      return true
  }
}

const allEndpoints = [...iterateEndpoints(schema)]
const getEndpoints = allEndpoints.filter(({ meta }) => meta.method === 'GET')

describe('mock server phục vụ toàn bộ schema', () => {
  it('đăng ký đúng số endpoint có trong schema', () => {
    expect(server.routeCount).toBe(schema.endpointCount)
    expect(server.routeCount).toBe(675)
  })

  it('có đủ 340 endpoint GET để kiểm', () => {
    expect(getEndpoints).toHaveLength(340)
  })

  it(
    'mọi endpoint GET đều trả lời đúng hình dạng returns',
    async () => {
      // Tắt độ trễ giả lập, nếu không 340 request sẽ mất hàng chục giây.
      server.mock.setLatency(0, 0)

      const failures: string[] = []

      for (const { path, meta } of getEndpoints) {
        const url = buildUrl(path, meta.params)

        let response: Response
        try {
          response = await fetch(url, { headers: { Cookie: cookie } })
        } catch (error) {
          failures.push(`GET ${path} — request lỗi: ${String(error)}`)
          continue
        }

        if (response.status !== 200) {
          failures.push(`GET ${path} — HTTP ${response.status}`)
          continue
        }

        const body = (await response.json()) as { data?: unknown }

        if (!('data' in body)) {
          failures.push(`GET ${path} — phản hồi không có khoá "data"`)
          continue
        }

        if (!conformsToReturns(body.data, meta.returns)) {
          failures.push(
            `GET ${path} — mong đợi ${meta.returns.type}, nhận được ${
              Array.isArray(body.data) ? 'array' : typeof body.data
            }`,
          )
        }
      }

      expect(failures, `${failures.length} endpoint không đạt:\n${failures.join('\n')}`).toEqual([])
    },
    120_000,
  )
})

describe('kiểm soát truy cập', () => {
  it('chặn request không có thông tin xác thực', async () => {
    const response = await fetch(`${baseUrl}/api2/json/cluster/resources`)
    expect(response.status).toBe(401)
  })

  it('chặn ghi khi thiếu CSRF token', async () => {
    const response = await fetch(`${baseUrl}/api2/json/nodes/pve1/qemu/100/status/start`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(401)
  })

  it('cho phép ghi khi có CSRF token', async () => {
    // VM 101 nằm trên pve2, không phải pve1 — gọi sai node thì mock trả 500,
    // đúng như Proxmox thật khi không tìm thấy tệp cấu hình.
    const response = await fetch(`${baseUrl}/api2/json/nodes/pve2/qemu/101/status/start`, {
      method: 'POST',
      headers: { Cookie: cookie, CSRFPreventionToken: csrfToken },
    })
    expect(response.status).toBe(200)
  })

  it('từ chối thao tác trên guest nằm ở node khác', async () => {
    const response = await fetch(`${baseUrl}/api2/json/nodes/pve1/qemu/101/status/start`, {
      method: 'POST',
      headers: { Cookie: cookie, CSRFPreventionToken: csrfToken },
    })
    expect(response.status).toBe(500)
  })

  it('chấp nhận API Token trên endpoint cho phép', async () => {
    const response = await fetch(`${baseUrl}/api2/json/cluster/resources`, {
      headers: {
        Authorization: 'PVEAPIToken=root@pam!automation=00000000-1111-2222-3333-444444444444',
      },
    })
    expect(response.status).toBe(200)
  })

  it('từ chối API Token trên endpoint có allowToken=false', async () => {
    // `/access/password` là một trong 5 endpoint chặn token.
    const response = await fetch(`${baseUrl}/api2/json/access/password`, {
      method: 'PUT',
      headers: {
        Authorization: 'PVEAPIToken=root@pam!automation=00000000-1111-2222-3333-444444444444',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ userid: 'root@pam', password: 'moi' }),
    })
    expect(response.status).toBe(403)
  })

  it('từ chối mật khẩu sai', async () => {
    const response = await fetch(`${baseUrl}/api2/json/access/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'root@pam', password: 'sai' }),
    })
    expect(response.status).toBe(401)
  })

  it('yêu cầu bước hai với tài khoản bật TFA', async () => {
    const response = await fetch(`${baseUrl}/api2/json/access/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'tfa@pve', password: 'batky' }),
    })
    const { data } = (await response.json()) as { data: { NeedTFA?: number; ticket?: string } }
    expect(data.NeedTFA).toBe(1)
    expect(typeof data.ticket).toBe('string')
  })
})

describe('kiểm tham số nghiêm khắc hơn Proxmox thật', () => {
  it('từ chối giá trị enum không hợp lệ', async () => {
    const response = await fetch(
      `${baseUrl}/api2/json/nodes/pve1/qemu/100/rrddata?timeframe=khong-ton-tai`,
      { headers: { Cookie: cookie } },
    )
    expect(response.status).toBe(400)

    const body = (await response.json()) as { errors?: Record<string, string> }
    expect(body.errors?.['timeframe']).toContain('enum')
  })

  it('từ chối khi thiếu tham số bắt buộc', async () => {
    // rrddata bắt buộc phải có timeframe.
    const response = await fetch(`${baseUrl}/api2/json/nodes/pve1/qemu/100/rrddata`, {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(400)

    const body = (await response.json()) as { errors?: Record<string, string> }
    expect(body.errors?.['timeframe']).toBe('parameter is missing')
  })
})
