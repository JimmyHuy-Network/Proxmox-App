import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { iterateEndpoints, loadSchema } from '@pve/schema'
import type { PveEndpointMeta, PveParamSpec, PvePathEntry } from '@pve/schema'
import type { EndpointRuntime } from '../src/core/runtime-types.ts'

/**
 * Sinh client có kiểu từ schema đã chuẩn hoá.
 *
 *   node scripts/generate.ts
 *
 * Phát ra hai tệp vào src/generated/:
 *
 *   paths.ts      chỉ chứa kiểu — interface `PveEndpoints` cho toàn bộ 675 endpoint
 *   endpoints.ts  bảng metadata lúc chạy — danh sách trắng cho IPC và bộ kiểm tham số
 *
 * Cố ý KHÔNG sinh schema Valibot cho từng endpoint. 675 schema dựng sẵn lúc khởi
 * động vừa nặng vừa khó test; một bảng metadata gọn cộng một hàm kiểm dùng chung
 * cho kết quả nhỏ hơn nhiều và chỉ có một đường mã cần kiểm chứng.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'src', 'generated')

const schema = loadSchema()

// ─────────────────────────────────────────────────────────────────────────────
// Tiện ích phát mã
// ─────────────────────────────────────────────────────────────────────────────

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function quoteKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name)
}

/** Tên dạng `net[n]` nghĩa là net0, net1, … — sinh index signature chứ không sinh khoá thường. */
function globPrefix(name: string): string | null {
  const match = /^(.+)\[n\]$/.exec(name)
  return match ? (match[1] as string) : null
}

function jsdoc(spec: PveParamSpec, indent: string): string {
  const parts: string[] = []

  if (spec.description) {
    const text = spec.description.replace(/\s+/g, ' ').trim()
    parts.push(text.length > 220 ? `${text.slice(0, 217)}…` : text)
  }
  if (spec.typetext) parts.push(`Cú pháp: ${spec.typetext}`)
  if (spec.default !== undefined) parts.push(`Mặc định: ${JSON.stringify(spec.default)}`)
  if (spec.format && typeof spec.format === 'string') parts.push(`Định dạng: ${spec.format}`)
  if (typeof spec.format === 'object') parts.push('Property string — dùng bộ codec để phân tích.')

  if (parts.length === 0) return ''

  // `*/` bên trong mô tả sẽ đóng sớm khối chú thích và làm hỏng cả tệp.
  const body = parts.join(' — ').replaceAll('*/', '*\\/')
  return `${indent}/** ${body} */\n`
}

// ─────────────────────────────────────────────────────────────────────────────
// Ánh xạ kiểu
// ─────────────────────────────────────────────────────────────────────────────

function unionOfEnum(values: string[]): string {
  return values.map((v) => JSON.stringify(v)).join(' | ')
}

function tsType(spec: PveParamSpec): string {
  if (spec.enum && spec.enum.length > 0) return unionOfEnum(spec.enum)

  switch (spec.type) {
    case 'string':
      return 'string'
    // Wire format của Proxmox gửi boolean dưới dạng 0/1, nhưng client lo việc
    // ép kiểu hai chiều nên phía người dùng vẫn thấy boolean.
    case 'boolean':
      return 'boolean'
    case 'integer':
    case 'number':
      return 'number'
    case 'array': {
      const item = spec.items ? tsType(spec.items) : 'unknown'
      return /[|&]/.test(item) ? `(${item})[]` : `${item}[]`
    }
    case 'object':
      return spec.properties ? objectType(spec.properties, '  ') : 'Record<string, unknown>'
    case 'null':
      return 'null'
    default:
      // `oneOf` (6 chỗ, phụ thuộc instance-types) và các trường thiếu `type`
      // rơi vào đây. Kiểu lỏng còn hơn kiểu sai.
      return 'unknown'
  }
}

/**
 * Sinh kiểu object, kèm index signature cho các trường đánh số.
 *
 * Tên dạng `net[n]` nghĩa là net0, net1, … Phải áp dụng cho **cả** tham số đầu vào
 * lẫn giá trị trả về: endpoint đọc cấu hình máy ảo trả về đúng những khoá đó, và
 * quên phần trả về thì `config['net0']` sẽ báo lỗi biên dịch dù dữ liệu có thật.
 */
function objectType(props: Record<string, PveParamSpec>, indent: string): string {
  const inner = `${indent}  `
  const lines: string[] = ['{']
  const globs = new Set<string>()

  for (const [name, spec] of Object.entries(props).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const prefix = globPrefix(name)
    if (prefix) {
      globs.add(prefix)
      continue
    }
    const doc = jsdoc(spec, inner)
    const optional = spec.optional ? '?' : ''
    lines.push(`${doc}${inner}${quoteKey(name)}${optional}: ${tsType(spec)}`)
  }

  lines.push(`${indent}}`)
  const base = lines.join('\n')

  if (globs.size === 0) return base

  const keys = [...globs]
    .sort()
    .map((p) => `\`${p}\${number}\``)
    .join(' | ')
  return `${base} & Partial<Record<${keys}, string>>`
}

/**
 * Endpoint nào thực chất trả về một UPID (định danh tác vụ chạy nền).
 *
 * Schema KHÔNG nói thẳng điều này. Chỉ 6 trên 107 endpoint trả chuỗi có mô tả nhắc
 * tới UPID, nên bắt theo mô tả là bỏ sót gần hết — kể cả `status/start` vốn hiển
 * nhiên trả UPID nhưng chỉ ghi `{"type":"string"}`.
 *
 * Quy luật dưới đây dựa trên cấu trúc, tận dụng một quan sát: **cả 100 endpoint
 * không phải GET mà trả chuỗi đều là `protected: true`**, và trong Proxmox một
 * endpoint thay đổi trạng thái trả về chuỗi trần thì đó là task id. Những endpoint
 * trả chuỗi vì lý do khác đều tự nhận diện được — chúng có `format` (như `mac-addr`
 * của wakeonlan) hoặc có `description` riêng (như "Redirection URL." của auth-url).
 *
 * Đây là gợi ý cho trình soạn thảo, không phải cơ chế bảo đảm. Lúc chạy, client
 * vẫn nhận diện UPID bằng `isUpid()` — định dạng UPID rất đặc thù nên không nhầm
 * được, và cách đó không bao giờ lỗi thời khi Proxmox đổi API.
 */
const NOT_UPID_EXCEPTIONS = new Set([
  // Trả về khoá lock của cấu hình SDN, không phải task id. Không có dấu hiệu nào
  // trong schema để tự suy ra, nên phải liệt kê tay.
  'POST /cluster/sdn/lock',
])

function returnsUpid(path: string, meta: PveEndpointMeta): boolean {
  if (meta.returns.type !== 'string') return false
  if (meta.method === 'GET') return false
  if (NOT_UPID_EXCEPTIONS.has(`${meta.method} ${path}`)) return false

  const description = meta.returns.description
  if (description) return /\bUPID\b/i.test(description)

  // Có `format` nghĩa là chuỗi mang ý nghĩa khác (địa chỉ MAC, URL…).
  return meta.returns.format === undefined
}

function returnType(path: string, meta: PveEndpointMeta): string {
  const spec = meta.returns

  if (returnsUpid(path, meta)) return 'Upid'

  switch (spec.type) {
    case 'array': {
      const items = spec.items
      if (items?.properties && Object.keys(items.properties).length > 0) {
        return `${objectType(items.properties, '    ')}[]`
      }
      return 'unknown[]'
    }
    case 'object':
      return spec.properties && Object.keys(spec.properties).length > 0
        ? objectType(spec.properties, '    ')
        : 'Record<string, unknown>'
    case 'null':
      return 'null'
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'unknown'
  }
}

function paramsType(entry: PvePathEntry, meta: PveEndpointMeta): string {
  // Có 3 endpoint khai báo thiếu path param trong `properties`; bổ sung lại,
  // nếu không thì không dựng được URL mà kiểu vẫn báo hợp lệ.
  const props: Record<string, PveParamSpec> = { ...meta.params }
  for (const name of entry.pathParams) {
    if (!props[name]) {
      props[name] = { type: 'string', description: 'Tham số đường dẫn.' }
    }
  }

  // `objectType` tự lo phần index signature cho các trường đánh số.
  return objectType(props, '    ')
}

// ─────────────────────────────────────────────────────────────────────────────
// paths.ts — chỉ kiểu
// ─────────────────────────────────────────────────────────────────────────────

function emitPaths(): string {
  const out: string[] = [
    '// TỆP SINH TỰ ĐỘNG — ĐỪNG SỬA TAY.',
    '// Sinh bởi packages/pve-api/scripts/generate.ts từ schema PVE ' + schema.pveVersion + '.',
    '// Chạy lại: npm run schema:generate',
    '',
    "import type { Upid } from '../core/upid.ts'",
    '',
    '/**',
    ' * Toàn bộ ' + schema.endpointCount + ' endpoint của Proxmox VE ' + schema.pveVersion + '.',
    ' *',
    ' * Đây là nguồn sự thật về kiểu cho renderer. Kênh IPC chỉ nhận chuỗi, nên an toàn',
    ' * kiểu đến từ bản đồ này chứ không phải từ bản thân kênh.',
    ' */',
    'export interface PveEndpoints {',
  ]

  for (const entry of Object.values(schema.paths)) {
    const methods = Object.entries(entry.methods)
    if (methods.length === 0) continue

    out.push(`  ${quoteKey(entry.path)}: {`)
    for (const [method, meta] of methods) {
      if (meta.description) {
        const text = meta.description.replace(/\s+/g, ' ').trim().replaceAll('*/', '*\\/')
        out.push(`    /** ${text.length > 220 ? `${text.slice(0, 217)}…` : text} */`)
      }
      out.push(`    ${method}: {`)
      out.push(`      params: ${paramsType(entry, meta)}`)
      out.push(`      returns: ${returnType(entry.path, meta)}`)
      out.push('    }')
    }
    out.push('  }')
  }

  out.push('}')
  out.push('')
  out.push('export type PvePath = keyof PveEndpoints')
  out.push('export type PveMethodOf<P extends PvePath> = keyof PveEndpoints[P] & string')
  out.push('')
  out.push('export type PveParams<P extends PvePath, M extends PveMethodOf<P>> =')
  out.push("  PveEndpoints[P][M] extends { params: infer T } ? T : never")
  out.push('')
  out.push('export type PveReturns<P extends PvePath, M extends PveMethodOf<P>> =')
  out.push("  PveEndpoints[P][M] extends { returns: infer T } ? T : never")
  out.push('')

  return out.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// endpoints.ts — metadata lúc chạy
// ─────────────────────────────────────────────────────────────────────────────

/** Mã kiểu một ký tự, để bảng 675 endpoint không phình ra vô ích. */
function typeCode(spec: PveParamSpec): string {
  switch (spec.type) {
    case 'string':
      return 's'
    case 'integer':
      return 'i'
    case 'number':
      return 'n'
    case 'boolean':
      return 'b'
    case 'array':
      return 'a'
    case 'object':
      return 'o'
    default:
      return 'u'
  }
}

function emitEndpoints(): string {
  const out: string[] = [
    '// TỆP SINH TỰ ĐỘNG — ĐỪNG SỬA TAY.',
    '// Sinh bởi packages/pve-api/scripts/generate.ts từ schema PVE ' + schema.pveVersion + '.',
    '',
    "import type { PathRuntime } from '../core/runtime-types.ts'",
    '',
    '/**',
    ' * Bảng tra lúc chạy cho toàn bộ ' + schema.endpointCount + ' endpoint.',
    ' *',
    ' * Đây là **ranh giới bảo mật** của kênh IPC: main đối chiếu path và method mà',
    ' * renderer gửi lên với bảng này trước khi gọi ra ngoài. Nhờ vậy renderer không',
    ' * dựng được URL tuỳ ý, và khả năng SSRF sang host khác bị loại bỏ hoàn toàn.',
    ' */',
    'export const PVE_PATHS: Record<string, PathRuntime> = {',
  ]

  for (const entry of Object.values(schema.paths)) {
    const methods = Object.entries(entry.methods)
    if (methods.length === 0) continue

    out.push(`  ${quoteKey(entry.path)}: {`)
    out.push(`    pathParams: ${JSON.stringify(entry.pathParams)},`)
    out.push('    methods: {')

    for (const [method, meta] of methods) {
      const globs = new Set<string>()
      const params: Record<string, unknown> = {}
      const required: string[] = []

      for (const [name, spec] of Object.entries(meta.params)) {
        const prefix = globPrefix(name)
        if (prefix) {
          globs.add(prefix)
          continue
        }
        if (!spec.optional) required.push(name)

        const compact: Record<string, unknown> = { t: typeCode(spec) }
        if (spec.enum && spec.enum.length > 0) compact['e'] = spec.enum
        if (spec.minimum !== undefined) compact['min'] = spec.minimum
        if (spec.maximum !== undefined) compact['max'] = spec.maximum
        if (spec.maxLength !== undefined) compact['maxLen'] = spec.maxLength
        if (typeof spec.format === 'string') compact['f'] = spec.format
        params[name] = compact
      }

      // Path param thiếu khai báo vẫn phải bắt buộc, nếu không sẽ dựng URL hỏng.
      for (const name of entry.pathParams) {
        if (!params[name]) {
          params[name] = { t: 's' }
          required.push(name)
        }
      }

      const runtime: EndpointRuntime = {
        name: meta.name,
        allowToken: meta.allowToken,
        protected: meta.protected,
        params: params as EndpointRuntime['params'],
        required: required.sort(),
        globs: [...globs].sort(),
      }

      out.push(`      ${method}: ${JSON.stringify(runtime)},`)
    }

    out.push('    },')
    out.push('  },')
  }

  out.push('}')
  out.push('')
  out.push(`export const PVE_SCHEMA_VERSION = ${JSON.stringify(schema.pveVersion)}`)
  out.push(`export const PVE_PATH_COUNT = ${schema.pathCount}`)
  out.push(`export const PVE_ENDPOINT_COUNT = ${schema.endpointCount}`)
  out.push('')

  return out.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// property-schemas.ts — sub-schema của property string
// ─────────────────────────────────────────────────────────────────────────────

/** Nhóm endpoint, dùng để đặt tên khi một tham số có nhiều biến thể schema. */
function familyOf(path: string): string {
  if (path.includes('/qemu')) return 'qemu'
  if (path.includes('/lxc')) return 'lxc'
  const segment = path.split('/')[1]
  return segment && segment.length > 0 ? segment : 'root'
}

/**
 * Chọn tên nhóm dễ hiểu nhất trong số các nhóm cùng dùng một schema.
 *
 * Xếp theo bảng chữ cái sẽ ra `nodes.net` cho schema card mạng của QEMU — đúng về
 * mặt kỹ thuật nhưng người đọc không hiểu. `qemu` và `lxc` mới là thứ mô tả đúng
 * bản chất, nên ưu tiên chúng.
 */
function preferredFamily(families: Set<string>): string {
  if (families.has('qemu')) return 'qemu'
  if (families.has('lxc')) return 'lxc'
  return [...families].sort()[0] ?? 'root'
}

function emitPropertySchemas(): string {
  // Gộp theo nội dung: `net[n]` xuất hiện ở nhiều endpoint nhưng thường cùng một
  // schema, giữ riêng từng bản sẽ phình vô ích.
  const bySignature = new Map<
    string,
    { spec: Record<string, unknown>; baseNames: Set<string>; families: Set<string> }
  >()

  for (const { path, meta } of iterateEndpoints(schema)) {
    for (const [name, spec] of Object.entries(meta.params)) {
      if (typeof spec.format !== 'object' || spec.format === null) continue

      const signature = JSON.stringify(spec.format, Object.keys(spec.format).sort())
      const base = globPrefix(name) ?? name

      let bucket = bySignature.get(signature)
      if (!bucket) {
        bucket = {
          spec: spec.format as Record<string, unknown>,
          baseNames: new Set(),
          families: new Set(),
        }
        bySignature.set(signature, bucket)
      }
      bucket.baseNames.add(base)
      bucket.families.add(familyOf(path))
    }
  }

  // Tên nào chỉ ứng với một schema thì dùng thẳng; tên có nhiều biến thể
  // (net, unused) thì thêm tiền tố nhóm để phân biệt.
  const variantsPerBase = new Map<string, number>()
  for (const bucket of bySignature.values()) {
    for (const base of bucket.baseNames) {
      variantsPerBase.set(base, (variantsPerBase.get(base) ?? 0) + 1)
    }
  }

  const named = new Map<string, Record<string, unknown>>()
  for (const bucket of bySignature.values()) {
    const base = [...bucket.baseNames].sort()[0] as string
    const key =
      (variantsPerBase.get(base) ?? 0) > 1 ? `${preferredFamily(bucket.families)}.${base}` : base
    named.set(key, bucket.spec)
  }

  const out: string[] = [
    '// TỆP SINH TỰ ĐỘNG — ĐỪNG SỬA TAY.',
    '// Sinh bởi packages/pve-api/scripts/generate.ts từ schema PVE ' + schema.pveVersion + '.',
    '',
    "import type { PropertyStringSchema } from '../core/property-string.ts'",
    '',
    '/**',
    ' * Sub-schema của các property string, lấy nguyên từ schema chính thức.',
    ' *',
    ' * Proxmox nhét cả cấu trúc con của những trường như `net0`, `scsi0`, `virtio0`',
    ' * ngay trong apidoc.js, nên phần lớn property string phân tích được mà không',
    ' * phải viết tay. Những trường chỉ có TÊN định dạng (`pve-qm-boot`,',
    ' * `pve-qm-hostpci`, `pve-qm-ipconfig`…) thì apidoc.js không kèm định nghĩa —',
    ' * chúng nằm trong core/property-models.ts.',
    ' */',
    'export const PVE_PROPERTY_SCHEMAS: Record<string, PropertyStringSchema> = {',
  ]

  for (const key of [...named.keys()].sort()) {
    out.push(`  ${quoteKey(key)}: ${JSON.stringify(named.get(key))},`)
  }

  out.push('}')
  out.push('')
  out.push('export type PvePropertySchemaName = keyof typeof PVE_PROPERTY_SCHEMAS')
  out.push('')

  return out.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })

  const paths = emitPaths()
  const endpoints = emitEndpoints()
  const propertySchemas = emitPropertySchemas()

  await writeFile(join(outDir, 'paths.ts'), paths, 'utf8')
  await writeFile(join(outDir, 'endpoints.ts'), endpoints, 'utf8')
  await writeFile(join(outDir, 'property-schemas.ts'), propertySchemas, 'utf8')

  const total = [...iterateEndpoints(schema)].length

  console.log(`Đã sinh ${total} endpoint từ schema PVE ${schema.pveVersion}`)
  console.log(`  src/generated/paths.ts             ${(paths.length / 1024).toFixed(0)} KB`)
  console.log(`  src/generated/endpoints.ts         ${(endpoints.length / 1024).toFixed(0)} KB`)
  console.log(`  src/generated/property-schemas.ts  ${(propertySchemas.length / 1024).toFixed(0)} KB`)
}

await main()
