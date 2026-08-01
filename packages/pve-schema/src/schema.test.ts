import { describe, expect, it } from 'vitest'
import { extractApiSchemaArray } from './extract.ts'
import { iterateEndpoints, loadSchema } from './index.ts'

/**
 * Hàng rào canh giữ schema.
 *
 * Proxmox **không đánh version cho API**, nên khi họ đổi thì không có tín hiệu nào
 * ngoài việc mọi thứ lặng lẽ sai. Những con số dưới đây chốt lại hình dạng của
 * PVE 9.2. Nếu chúng thay đổi sau khi chạy `npm run schema:fetch`, đó là tin tức
 * cần đọc kỹ chứ không phải test hỏng cần sửa cho qua.
 */

const schema = loadSchema()

describe('schema đã chuẩn hoá', () => {
  it('khớp số lượng của PVE 9.2', () => {
    expect(schema.pveVersion).toBe('9.2')
    expect(schema.pathCount).toBe(449)
    expect(schema.endpointCount).toBe(675)
  })

  it('số endpoint đếm lại khớp với số đã ghi', () => {
    expect([...iterateEndpoints(schema)]).toHaveLength(schema.endpointCount)
  })

  it('chỉ đúng 5 endpoint chặn API Token', () => {
    const blocked = [...iterateEndpoints(schema)]
      .filter(({ meta }) => !meta.allowToken)
      .map(({ path, meta }) => `${meta.method} ${path}`)
      .sort()

    expect(blocked).toEqual([
      'DELETE /access/tfa/{userid}/{id}',
      'POST /access/tfa/{userid}',
      'POST /access/ticket',
      'PUT /access/password',
      'PUT /access/tfa/{userid}/{id}',
    ])
  })

  it('mọi endpoint console đều cho phép API Token', () => {
    // Trái với tài liệu cũ trên forum về các bản PVE trước, vốn nói API Token không
    // mở được /termproxy. Trong PVE 9.2 thì cả 11 endpoint console đều cho phép.
    // Nếu bài test này hỏng thì Proxmox đã siết lại và luồng xác thực console phải
    // xem lại theo — đừng sửa danh sách cho qua.
    const consoleEndpoints = [...iterateEndpoints(schema)]
      .filter(({ path }) => /termproxy|vncproxy|vncwebsocket|spiceproxy|vncshell/.test(path))
      .map(({ path, meta }) => `${meta.method} ${path} allowToken=${meta.allowToken}`)
      .sort()

    expect(consoleEndpoints).toEqual([
      'GET /nodes/{node}/lxc/{vmid}/vncwebsocket allowToken=true',
      'GET /nodes/{node}/qemu/{vmid}/vncwebsocket allowToken=true',
      'GET /nodes/{node}/vncwebsocket allowToken=true',
      'POST /nodes/{node}/lxc/{vmid}/spiceproxy allowToken=true',
      'POST /nodes/{node}/lxc/{vmid}/termproxy allowToken=true',
      'POST /nodes/{node}/lxc/{vmid}/vncproxy allowToken=true',
      'POST /nodes/{node}/qemu/{vmid}/spiceproxy allowToken=true',
      'POST /nodes/{node}/qemu/{vmid}/termproxy allowToken=true',
      'POST /nodes/{node}/qemu/{vmid}/vncproxy allowToken=true',
      'POST /nodes/{node}/termproxy allowToken=true',
      'POST /nodes/{node}/vncshell allowToken=true',
    ])

    // PVE 9.2 bổ sung endpoint này để xác minh VNC ticket do token sở hữu — đúng
    // như roadmap 9.2 nhắc tới. Sự tồn tại của nó củng cố kết luận ở trên.
    expect(schema.paths['/access/vncticket']?.methods.POST?.allowToken).toBe(true)
  })

  it('lấy path param từ mẫu đường dẫn, kể cả khi không khai báo trong params', () => {
    // 3 endpoint của prefix-lists khai báo thiếu path param trong `properties`.
    // Nếu suy ra từ `properties` thì URL dựng ra sẽ sai.
    const entry = schema.paths['/cluster/sdn/prefix-lists/{id}/entries/{url_seq}']
    expect(entry?.pathParams).toEqual(['id', 'url_seq'])
    expect(entry?.methods.PUT?.params['url_seq']).toBeUndefined()
  })

  it('giữ được tên path param có dấu gạch ngang', () => {
    const entry = schema.paths['/nodes/{node}/hardware/pci/{pci-id-or-mapping}']
    expect(entry?.pathParams).toEqual(['node', 'pci-id-or-mapping'])
  })

  it('chuẩn hoá optional về boolean kể cả khi nguồn ghi bằng chuỗi', () => {
    // 5 tham số của endpoint này ghi optional dưới dạng chuỗi "1".
    const params = schema.paths['/access/domains/{realm}/sync']?.methods.POST?.params
    expect(params?.['scope']?.optional).toBe(true)
    expect(params?.['full']?.optional).toBe(true)
  })

  it('giữ sub-schema nội tuyến của property string', () => {
    const net = schema.paths['/nodes/{node}/qemu/{vmid}/config']?.methods.PUT?.params['net[n]']
    expect(typeof net?.format).toBe('object')

    const format = net?.format as Record<string, unknown>
    expect(format['bridge']).toMatchObject({ type: 'string', optional: true })
    // Các mục bí danh phải được giữ nguyên để bộ parse hiểu `e1000=AA:BB:…`,
    // nhưng generator sẽ bỏ qua chúng khi sinh kiểu.
    expect(format['e1000']).toEqual({ alias: 'macaddr', keyAlias: 'model' })
  })
})

describe('extractApiSchemaArray', () => {
  it('dừng đúng ở dấu ] đóng mảng, bỏ qua mã JS phía sau', () => {
    const source = `const apiSchema = [{"path":"/a","text":"a"}]\n;\nExt.onReady(function(){ let x = "]"; });`
    expect(extractApiSchemaArray(source)).toEqual([{ path: '/a', text: 'a' }])
  })

  it('không bị lừa bởi dấu ngoặc nằm trong chuỗi', () => {
    const source = `const apiSchema = [{"description":"chứa ] và } bên trong"}];`
    expect(extractApiSchemaArray(source)).toEqual([{ description: 'chứa ] và } bên trong' }])
  })

  it('không bị lừa bởi dấu ngoặc kép đã escape', () => {
    const source = String.raw`const apiSchema = [{"d":"dấu \" rồi ]"}];`
    expect(extractApiSchemaArray(source)).toEqual([{ d: 'dấu " rồi ]' }])
  })

  it('báo lỗi rõ ràng khi định dạng đổi', () => {
    expect(() => extractApiSchemaArray('var somethingElse = [];')).toThrow(/const apiSchema/)
  })

  it('báo lỗi khi tệp bị cụt', () => {
    expect(() => extractApiSchemaArray('const apiSchema = [{"a":1}')).toThrow(/cụt/)
  })
})
