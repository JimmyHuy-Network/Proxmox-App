/**
 * Bộ mã hoá/giải mã property string của Proxmox.
 *
 * Rất nhiều trường trong Proxmox nhìn như object nhưng thực chất là chuỗi có cấu trúc:
 *
 *     virtio0: "local-lvm:vm-100-disk-0,size=32G,iothread=1"
 *     net0:    "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1"
 *     mp0:     "local:100/vm-100-disk-1.raw,mp=/data,backup=1"
 *
 * Hai chi tiết dễ bỏ sót, và cả hai đều được mô tả sẵn trong schema:
 *
 * **Khoá vị trí** — trường đánh dấu `default_key` viết được mà không cần tên.
 * Trong ví dụ trên, `local-lvm:vm-100-disk-0` chính là `file=local-lvm:vm-100-disk-0`.
 *
 * **Bí danh** — schema của `net` chứa những mục như
 * `{ "e1000": { "alias": "macaddr", "keyAlias": "model" } }`. Nghĩa là viết
 * `e1000=AA:BB:...` tương đương `model=e1000,macaddr=AA:BB:...`. Đây chính là cách
 * Proxmox biểu diễn model card mạng, nên không xử lý thì `net0` phân tích ra sai.
 */

export interface PropertySpec {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'null'
  optional?: boolean
  description?: string
  default?: unknown
  enum?: string[]
  /** Trường này viết được mà không cần ghi tên. Mỗi schema chỉ có nhiều nhất một. */
  defaultKey?: boolean
  [extra: string]: unknown
}

export interface PropertyAlias {
  alias: string
  keyAlias?: string
}

export type PropertyStringSchema = Record<string, PropertySpec | PropertyAlias>

export function isAlias(entry: PropertySpec | PropertyAlias): entry is PropertyAlias {
  return typeof (entry as PropertyAlias).alias === 'string'
}

function defaultKeyOf(schema: PropertyStringSchema | undefined): string | null {
  if (!schema) return null
  for (const [name, entry] of Object.entries(schema)) {
    if (!isAlias(entry) && entry.defaultKey) return name
  }
  return null
}

/**
 * Khoá dùng cho giá trị vị trí khi không có schema để biết tên thật của nó.
 * Có schema thì giá trị được gán thẳng vào đúng tên trường.
 */
export const POSITIONAL_KEY = '__positional__'

/**
 * Phân tích một property string thành các cặp khoá–giá trị.
 *
 * Giá trị trả về luôn là chuỗi — ép sang số hay boolean là việc của bên gọi, vì
 * chỉ bên gọi mới biết trường đó là kiểu gì. Truyền `schema` vào để giải bí danh
 * và đặt đúng tên cho giá trị vị trí.
 */
export function parsePropertyString(
  input: string,
  schema?: PropertyStringSchema,
): Record<string, string> {
  const result: Record<string, string> = {}
  if (input === '') return result

  const positionalName = defaultKeyOf(schema) ?? POSITIONAL_KEY
  let positionalTaken = false

  for (const rawPart of input.split(',')) {
    const part = rawPart.trim()
    if (part === '') continue

    const eq = part.indexOf('=')

    // Không có dấu bằng: đây là giá trị vị trí. Chỉ nhận cái đầu tiên —
    // Proxmox cũng chỉ cho phép một.
    if (eq < 0) {
      if (!positionalTaken) {
        result[positionalName] = part
        positionalTaken = true
      }
      continue
    }

    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === '') continue

    const entry = schema?.[key]

    if (entry && isAlias(entry)) {
      // `e1000=AA:BB:…` nở ra thành `macaddr=AA:BB:…` cộng `model=e1000`.
      result[entry.alias] = value
      if (entry.keyAlias) result[entry.keyAlias] = key
      continue
    }

    result[key] = value
  }

  return result
}

/**
 * Dựng lại property string từ các cặp khoá–giá trị.
 *
 * Bỏ qua `undefined` và `null` để bên gọi truyền thẳng object có trường tuỳ chọn.
 * Boolean chuyển thành `1`/`0` đúng như Proxmox chờ đợi.
 */
export function formatPropertyString(
  values: Record<string, string | number | boolean | null | undefined>,
  schema?: PropertyStringSchema,
): string {
  const positionalName = defaultKeyOf(schema) ?? POSITIONAL_KEY
  const parts: string[] = []

  const encode = (value: string | number | boolean): string => {
    if (typeof value === 'boolean') return value ? '1' : '0'
    return String(value)
  }

  // Giá trị vị trí phải đứng đầu, nếu không Proxmox sẽ hiểu sai.
  const positional = values[positionalName]
  if (positional !== undefined && positional !== null && positional !== '') {
    parts.push(encode(positional))
  }

  for (const [key, value] of Object.entries(values)) {
    if (key === positionalName) continue
    if (value === undefined || value === null) continue
    parts.push(`${key}=${encode(value)}`)
  }

  return parts.join(',')
}

/** Đọc một trường boolean từ property string đã phân tích. Proxmox ghi 0/1. */
export function propBool(values: Record<string, string>, key: string): boolean | undefined {
  const raw = values[key]
  if (raw === undefined) return undefined
  return raw === '1' || raw.toLowerCase() === 'true'
}

/** Đọc một trường số. Trả về undefined nếu vắng mặt hoặc không phải số. */
export function propNumber(values: Record<string, string>, key: string): number | undefined {
  const raw = values[key]
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Đọc kích thước có hậu tố của Proxmox (`32G`, `512M`, `1T`) thành số byte.
 * Không có hậu tố thì hiểu là byte.
 */
export function parseSize(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const match = /^(\d+(?:\.\d+)?)\s*([KMGTP])?i?B?$/i.exec(raw.trim())
  if (!match) return undefined

  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined

  const unit = match[2]?.toUpperCase()
  const factor: Record<string, number> = {
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  }

  return unit ? value * (factor[unit] as number) : value
}
