export type PveHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * Mã kiểu một ký tự, giữ cho bảng 675 endpoint không phình vô ích.
 *
 * s=string  i=integer  n=number  b=boolean  a=array  o=object  u=không rõ
 */
export type ParamTypeCode = 's' | 'i' | 'n' | 'b' | 'a' | 'o' | 'u'

export interface ParamRuntime {
  t: ParamTypeCode
  /** Các giá trị hợp lệ, nếu tham số là enum. */
  e?: string[]
  min?: number
  max?: number
  maxLen?: number
  /** Tên định dạng của Proxmox, ví dụ `pve-node`, `pve-vmid`, `pve-qm-boot`. */
  f?: string
}

export interface EndpointRuntime {
  /** Tên phương thức trong API của Proxmox, ví dụ `vm_start`. Hữu ích khi báo lỗi. */
  name: string
  /**
   * API Token gọi được endpoint này không. Trong PVE 9.2 chỉ 5 endpoint đặt false
   * (`/access/ticket`, `/access/password`, và ba endpoint TFA).
   */
  allowToken: boolean
  protected: boolean
  params: Record<string, ParamRuntime>
  required: string[]
  /**
   * Tiền tố của các tham số đánh số, ví dụ `['net', 'scsi']` nghĩa là chấp nhận
   * `net0`, `net1`, `scsi0`… Trong schema chúng xuất hiện dưới dạng `net[n]`.
   */
  globs: string[]
}

export interface PathRuntime {
  pathParams: string[]
  methods: Partial<Record<PveHttpMethod, EndpointRuntime>>
}
