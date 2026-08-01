export type PveHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type PveScalarType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'null'

/**
 * Một mục trong sub-schema của property string chỉ để đặt bí danh, không phải khoá thật.
 *
 * Ví dụ trong `net[n]`, khoá `e1000` xuất hiện dưới dạng
 * `{ "alias": "macaddr", "keyAlias": "model" }` — nghĩa là viết `e1000=AA:BB:...`
 * tương đương `model=e1000,macaddr=AA:BB:...`. Đây KHÔNG phải một trường dữ liệu,
 * và generator phải bỏ qua nếu không sẽ sinh ra hàng chục khoá rác.
 */
export interface PvePropertyAlias {
  alias: string
  keyAlias?: string
}

export interface PveParamSpec {
  type?: PveScalarType
  /** Đã chuẩn hoá thành boolean. Trong nguồn nó có thể là 0, 1, hoặc chuỗi "1". */
  optional?: boolean
  description?: string
  verboseDescription?: string
  /** Chuỗi mô tả cú pháp, ví dụ `[address=]<IP> [,priority=<integer>]`. */
  typetext?: string
  default?: unknown
  enum?: string[]
  /**
   * Hoặc là **tên** một định dạng (`pve-node`, `pve-vmid`, `pve-qm-boot`...), hoặc là
   * **sub-schema nội tuyến** của một property string.
   *
   * Dạng object là thứ cho phép sinh kiểu tự động cho `net[n]`, `scsi[n]`, `virtio[n]`...
   * Dạng chuỗi thì apidoc.js không kèm định nghĩa, nên phải viết tay nếu cần.
   */
  format?: string | Record<string, PveParamSpec | PvePropertyAlias>
  formatDescription?: string
  pattern?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  items?: PveParamSpec
  properties?: Record<string, PveParamSpec>
  /** Trong sub-schema property string: khoá này viết được không cần tên. */
  defaultKey?: boolean
  /** Tham số này chỉ hợp lệ khi tham số kia có mặt. */
  requires?: string
  /** Vài chỗ dùng union phụ thuộc `instance-types`. Hiếm, và không sinh kiểu chặt được. */
  oneOf?: PveParamSpec[]
}

export interface PveReturnSpec extends PveParamSpec {
  links?: { href: string; rel: string }[]
}

export interface PveEndpointMeta {
  /** Tên phương thức trong API của Proxmox, ví dụ `vm_start`. */
  name: string
  method: PveHttpMethod
  description?: string
  /**
   * API Token có gọi được endpoint này không.
   *
   * Trong PVE 9.2 chỉ có **5** endpoint đặt false: `/access/ticket`, `/access/password`,
   * và ba endpoint quản lý TFA. Đáng chú ý là mọi endpoint console (`termproxy`,
   * `vncproxy`, `vncshell`, `vncwebsocket`) đều cho phép token — khác với tài liệu
   * cũ trên forum. Vẫn nên đối chiếu với server thật trước khi tin hoàn toàn.
   */
  allowToken: boolean
  /** Cần quyền root hoặc phải chạy qua pvedaemon. */
  protected: boolean
  /** Endpoint được chuyển tiếp tới node nào (`node`, `master`, hoặc tên cụ thể). */
  proxyTo?: string
  downloadAllowed?: boolean
  permissions?: unknown
  params: Record<string, PveParamSpec>
  returns: PveReturnSpec
}

export interface PvePathEntry {
  path: string
  /**
   * Trích từ chính mẫu đường dẫn, KHÔNG phải từ `params`.
   *
   * Có 3 endpoint khai báo thiếu path param trong `properties` (các đường dẫn
   * `/cluster/sdn/prefix-lists/{id}/entries/{url_seq}`), nên lấy theo `properties`
   * sẽ dựng URL sai.
   */
  pathParams: string[]
  methods: Partial<Record<PveHttpMethod, PveEndpointMeta>>
}

export interface PveSchema {
  /** Phiên bản PVE mà schema này chụp lại. API của Proxmox không đánh version. */
  pveVersion: string
  sourceUrl: string
  sourceSha256: string
  sourceBytes: number
  pathCount: number
  endpointCount: number
  paths: Record<string, PvePathEntry>
}
