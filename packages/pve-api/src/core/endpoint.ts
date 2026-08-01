import { PVE_PATHS } from '../generated/endpoints.ts'
import type { EndpointRuntime, PathRuntime, ParamRuntime, PveHttpMethod } from './runtime-types.ts'

/**
 * Tra cứu, kiểm tra và dựng request từ bảng endpoint sinh tự động.
 *
 * Đây là **ranh giới bảo mật** của kênh IPC. Renderer gửi lên một *mẫu* đường dẫn
 * (`/nodes/{node}/qemu/{vmid}/status/start`) chứ không phải URL đã điền. Main đối
 * chiếu mẫu đó với bảng sinh sẵn rồi mới điền tham số, nên renderer không dựng được
 * URL tuỳ ý và khả năng SSRF sang host khác bị loại bỏ hoàn toàn.
 */

export interface ValidationIssue {
  param: string
  message: string
}

export function findPath(path: string): PathRuntime | undefined {
  // Dùng Object.hasOwn để `__proto__` hay `constructor` không tra ra thứ gì.
  return Object.hasOwn(PVE_PATHS, path) ? PVE_PATHS[path] : undefined
}

export function findEndpoint(path: string, method: PveHttpMethod): EndpointRuntime | undefined {
  return findPath(path)?.methods[method]
}

/** Tên tham số dạng `net0`, `scsi3` có khớp một glob mà endpoint chấp nhận không. */
function matchesGlob(name: string, globs: string[]): boolean {
  for (const prefix of globs) {
    if (name.startsWith(prefix)) {
      const suffix = name.slice(prefix.length)
      if (suffix.length > 0 && /^\d+$/.test(suffix)) return true
    }
  }
  return false
}

function describeType(code: ParamRuntime['t']): string {
  switch (code) {
    case 's':
      return 'chuỗi'
    case 'i':
      return 'số nguyên'
    case 'n':
      return 'số'
    case 'b':
      return 'boolean'
    case 'a':
      return 'mảng'
    case 'o':
      return 'object'
    default:
      return 'giá trị'
  }
}

function checkValue(name: string, spec: ParamRuntime, value: unknown): ValidationIssue | null {
  if (spec.e && spec.e.length > 0) {
    const text = typeof value === 'string' ? value : String(value)
    if (!spec.e.includes(text)) {
      return { param: name, message: `phải là một trong: ${spec.e.join(', ')}` }
    }
    return null
  }

  switch (spec.t) {
    case 's': {
      if (typeof value !== 'string') {
        return { param: name, message: `phải là ${describeType(spec.t)}` }
      }
      if (spec.maxLen !== undefined && value.length > spec.maxLen) {
        return { param: name, message: `dài quá ${spec.maxLen} ký tự` }
      }
      return null
    }

    case 'i':
    case 'n': {
      // Proxmox nhận số dưới dạng chuỗi trong query, nên chấp nhận cả hai.
      const numeric = typeof value === 'number' ? value : Number(value)
      if (typeof value !== 'number' && typeof value !== 'string') {
        return { param: name, message: `phải là ${describeType(spec.t)}` }
      }
      if (!Number.isFinite(numeric)) {
        return { param: name, message: `phải là ${describeType(spec.t)}` }
      }
      if (spec.t === 'i' && !Number.isInteger(numeric)) {
        return { param: name, message: 'phải là số nguyên' }
      }
      if (spec.min !== undefined && numeric < spec.min) {
        return { param: name, message: `phải lớn hơn hoặc bằng ${spec.min}` }
      }
      if (spec.max !== undefined && numeric > spec.max) {
        return { param: name, message: `phải nhỏ hơn hoặc bằng ${spec.max}` }
      }
      return null
    }

    case 'b': {
      // Wire format là 0/1, nhưng phía gọi dùng boolean; nhận cả hai cho tiện.
      if (typeof value === 'boolean') return null
      if (value === 0 || value === 1 || value === '0' || value === '1') return null
      return { param: name, message: 'phải là boolean' }
    }

    case 'a': {
      if (!Array.isArray(value) && typeof value !== 'string') {
        return { param: name, message: 'phải là mảng hoặc chuỗi phân tách bằng dấu phẩy' }
      }
      return null
    }

    default:
      return null
  }
}

/**
 * Kiểm tham số trước khi gửi đi.
 *
 * Cố ý **không** dùng thư viện schema. 675 endpoint × schema dựng sẵn vừa nặng
 * lúc khởi động vừa khó test; một bảng metadata gọn cộng hàm này cho kết quả nhỏ
 * hơn nhiều và chỉ có một đường mã cần kiểm chứng.
 */
export function validateParams(
  endpoint: EndpointRuntime,
  pathParams: string[],
  params: Record<string, unknown> = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const name of endpoint.required) {
    const value = params[name]
    if (value === undefined || value === null || value === '') {
      issues.push({ param: name, message: 'bắt buộc phải có' })
    }
  }

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue

    const spec = Object.hasOwn(endpoint.params, name) ? endpoint.params[name] : undefined

    if (!spec) {
      // Tham số đánh số như `net0` không có mặt trong bảng; chúng khớp qua glob.
      if (matchesGlob(name, endpoint.globs)) continue
      // Path param luôn hợp lệ dù có khai báo trong properties hay không.
      if (pathParams.includes(name)) continue
      issues.push({ param: name, message: 'không phải tham số của endpoint này' })
      continue
    }

    const issue = checkValue(name, spec, value)
    if (issue) issues.push(issue)
  }

  return issues
}

/**
 * Điền tham số vào mẫu đường dẫn và trả về phần còn lại để đưa vào query hoặc body.
 *
 * Mã hoá từng đoạn bằng `encodeURIComponent`, nên tên storage có dấu hai chấm hay
 * volume id có dấu gạch chéo cũng không phá vỡ đường dẫn.
 */
export function buildPath(
  pathTemplate: string,
  pathParams: string[],
  params: Record<string, unknown> = {},
): { pathname: string; rest: Record<string, unknown> } {
  const rest: Record<string, unknown> = { ...params }

  const pathname = pathTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name]
    if (value === undefined || value === null) {
      throw new Error(`Thiếu tham số đường dẫn "${name}" cho ${pathTemplate}`)
    }
    delete rest[name]
    return encodeURIComponent(String(value))
  })

  // Tham số đường dẫn khai báo mà không xuất hiện trong mẫu thì cũng không cần gửi kèm.
  for (const name of pathParams) delete rest[name]

  return { pathname, rest }
}

/**
 * Chuyển tham số sang dạng dây dẫn của Proxmox.
 *
 * Điểm quan trọng: **boolean gửi đi dưới dạng `1`/`0`**, không phải `true`/`false`.
 * Gửi sai thì Proxmox hiểu chuỗi "false" là giá trị có thật và bật cờ lên.
 */
export function encodeParams(params: Record<string, unknown>): Record<string, string> {
  const encoded: Record<string, string> = {}

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue

    if (typeof value === 'boolean') {
      encoded[name] = value ? '1' : '0'
    } else if (Array.isArray(value)) {
      encoded[name] = value.join(',')
    } else {
      encoded[name] = String(value)
    }
  }

  return encoded
}

/**
 * Giải mã boolean trong phản hồi. Proxmox trả về 0/1, đôi khi là chuỗi "0"/"1".
 * Bên gọi dùng khi biết chắc trường đó là boolean theo schema.
 */
export function decodeBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  return undefined
}
