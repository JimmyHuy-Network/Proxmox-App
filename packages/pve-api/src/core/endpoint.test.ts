import { describe, expect, it } from 'vitest'
import {
  buildPath,
  decodeBool,
  encodeParams,
  findEndpoint,
  findPath,
  validateParams,
} from './endpoint.ts'
import { PVE_ENDPOINT_COUNT, PVE_PATH_COUNT } from '../generated/endpoints.ts'

describe('bảng endpoint sinh tự động', () => {
  it('chứa đủ số endpoint của PVE 9.2', () => {
    expect(PVE_PATH_COUNT).toBe(449)
    expect(PVE_ENDPOINT_COUNT).toBe(675)
  })

  it('tra được endpoint có thật', () => {
    const endpoint = findEndpoint('/nodes/{node}/qemu/{vmid}/status/start', 'POST')
    expect(endpoint?.name).toBe('vm_start')
    expect(endpoint?.protected).toBe(true)
  })

  it('trả undefined với endpoint không tồn tại', () => {
    expect(findEndpoint('/khong/co/that', 'GET')).toBeUndefined()
    expect(findEndpoint('/nodes/{node}/qemu', 'DELETE')).toBeUndefined()
  })

  it('không bị lừa bởi thuộc tính kế thừa từ Object', () => {
    // Nếu tra bằng `PVE_PATHS[path]` trần thì `__proto__` và `constructor` sẽ
    // trả về thứ gì đó, và bộ kiểm tra danh sách trắng coi như hợp lệ.
    expect(findPath('__proto__')).toBeUndefined()
    expect(findPath('constructor')).toBeUndefined()
    expect(findPath('toString')).toBeUndefined()
  })

  it('ghi nhận 5 endpoint chặn API Token', () => {
    expect(findEndpoint('/access/ticket', 'POST')?.allowToken).toBe(false)
    expect(findEndpoint('/access/password', 'PUT')?.allowToken).toBe(false)
    // Console thì cho phép — xem ghi chú trong packages/pve-schema.
    expect(findEndpoint('/nodes/{node}/termproxy', 'POST')?.allowToken).toBe(true)
  })
})

describe('validateParams', () => {
  const startPath = findPath('/nodes/{node}/qemu/{vmid}/status/start')
  const start = startPath?.methods.POST

  it('báo thiếu tham số bắt buộc', () => {
    const issues = validateParams(start!, startPath!.pathParams, {})
    expect(issues.map((i) => i.param).sort()).toEqual(['node', 'vmid'])
  })

  it('chấp nhận tham số hợp lệ', () => {
    expect(validateParams(start!, startPath!.pathParams, { node: 'pve1', vmid: 100 })).toEqual([])
  })

  it('từ chối tham số không thuộc endpoint', () => {
    const issues = validateParams(start!, startPath!.pathParams, {
      node: 'pve1',
      vmid: 100,
      thamSoBia: 'x',
    })
    expect(issues).toEqual([{ param: 'thamSoBia', message: 'không phải tham số của endpoint này' }])
  })

  it('kiểm giá trị enum', () => {
    const issues = validateParams(start!, startPath!.pathParams, {
      node: 'pve1',
      vmid: 100,
      migration_type: 'khong-hop-le',
    })
    expect(issues[0]?.param).toBe('migration_type')
    expect(issues[0]?.message).toContain('secure')
  })

  it('chấp nhận tham số đánh số khớp glob', () => {
    const entry = findPath('/nodes/{node}/qemu/{vmid}/config')
    const config = entry?.methods.PUT
    expect(config?.globs).toContain('net')

    const ok = validateParams(config!, entry!.pathParams, {
      node: 'pve1',
      vmid: 100,
      net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
      scsi3: 'local-lvm:vm-100-disk-0',
    })
    expect(ok).toEqual([])
  })

  it('từ chối tham số đánh số không có hậu tố số', () => {
    const entry = findPath('/nodes/{node}/qemu/{vmid}/config')
    const issues = validateParams(entry!.methods.PUT!, entry!.pathParams, {
      node: 'pve1',
      vmid: 100,
      netfoo: 'x',
    })
    expect(issues[0]?.param).toBe('netfoo')
  })

  it('kiểm khoảng giá trị số', () => {
    const entry = findPath('/nodes/{node}/qemu/{vmid}/config')
    const issues = validateParams(entry!.methods.PUT!, entry!.pathParams, {
      node: 'pve1',
      vmid: 100,
      // vmid trong config có giới hạn dưới là 100
      cores: 0,
    })
    expect(issues.some((i) => i.param === 'cores')).toBe(true)
  })

  it('chấp nhận số gửi dưới dạng chuỗi', () => {
    // Tham số đi qua query string nên số thường về dưới dạng chuỗi.
    expect(validateParams(start!, startPath!.pathParams, { node: 'pve1', vmid: '100' })).toEqual([])
  })

  it('chấp nhận boolean ở cả dạng boolean và 0/1', () => {
    const entry = findPath('/nodes/{node}/qemu/{vmid}/status/shutdown')
    const shutdown = entry?.methods.POST
    for (const value of [true, false, 1, 0, '1', '0']) {
      expect(
        validateParams(shutdown!, entry!.pathParams, { node: 'pve1', vmid: 100, forceStop: value }),
        `giá trị ${JSON.stringify(value)}`,
      ).toEqual([])
    }
  })
})

describe('buildPath', () => {
  it('điền tham số và tách phần còn lại', () => {
    const { pathname, rest } = buildPath(
      '/nodes/{node}/qemu/{vmid}/status/start',
      ['node', 'vmid'],
      { node: 'pve1', vmid: 100, timeout: 30 },
    )
    expect(pathname).toBe('/nodes/pve1/qemu/100/status/start')
    expect(rest).toEqual({ timeout: 30 })
  })

  it('mã hoá từng đoạn đường dẫn', () => {
    // Volume id chứa dấu gạch chéo — không mã hoá thì nó tự tạo thêm đoạn đường dẫn.
    const { pathname } = buildPath(
      '/nodes/{node}/storage/{storage}/content/{volume}',
      ['node', 'storage', 'volume'],
      { node: 'pve1', storage: 'local', volume: 'local:100/vm-100-disk-0.raw' },
    )
    expect(pathname).toBe('/nodes/pve1/storage/local/content/local%3A100%2Fvm-100-disk-0.raw')
  })

  it('xử lý được tên tham số có dấu gạch ngang', () => {
    const { pathname } = buildPath(
      '/nodes/{node}/hardware/pci/{pci-id-or-mapping}',
      ['node', 'pci-id-or-mapping'],
      { node: 'pve1', 'pci-id-or-mapping': '0000:01:00.0' },
    )
    expect(pathname).toBe('/nodes/pve1/hardware/pci/0000%3A01%3A00.0')
  })

  it('báo lỗi rõ ràng khi thiếu tham số đường dẫn', () => {
    expect(() => buildPath('/nodes/{node}/status', ['node'], {})).toThrow(/Thiếu tham số đường dẫn/)
  })
})

describe('encodeParams', () => {
  it('gửi boolean dưới dạng 1/0 chứ không phải true/false', () => {
    // Gửi chuỗi "false" thì Proxmox coi đó là giá trị có thật và bật cờ lên.
    expect(encodeParams({ force: true, quiet: false })).toEqual({ force: '1', quiet: '0' })
  })

  it('nối mảng bằng dấu phẩy', () => {
    expect(encodeParams({ vmid: [100, 101] })).toEqual({ vmid: '100,101' })
  })

  it('bỏ qua undefined và null', () => {
    expect(encodeParams({ a: 1, b: undefined, c: null })).toEqual({ a: '1' })
  })
})

describe('decodeBool', () => {
  it('hiểu mọi cách Proxmox viết boolean', () => {
    expect(decodeBool(1)).toBe(true)
    expect(decodeBool('1')).toBe(true)
    expect(decodeBool(0)).toBe(false)
    expect(decodeBool('0')).toBe(false)
    expect(decodeBool(true)).toBe(true)
    expect(decodeBool(undefined)).toBeUndefined()
  })
})
