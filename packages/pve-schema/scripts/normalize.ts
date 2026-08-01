import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractApiSchemaArray } from '../src/extract.ts'
import type {
  PveEndpointMeta,
  PveHttpMethod,
  PveParamSpec,
  PvePathEntry,
  PveReturnSpec,
  PveSchema,
} from '../src/types.ts'

/**
 * Làm phẳng cây trong apidoc.js thành bản đồ theo đường dẫn, và chuẩn hoá những
 * chỗ lệch chuẩn của Proxmox.
 *
 *   node scripts/normalize.ts
 */

const PVE_VERSION = '9.2'
const SOURCE_URL = 'https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js'
const HTTP_METHODS: PveHttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE']

const here = dirname(fileURLToPath(import.meta.url))
const rawPath = join(here, '..', 'raw', 'apidoc.js')
const outDir = join(here, '..', 'generated')
const outPath = join(outDir, `pve-${PVE_VERSION}.schema.json`)

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `optional` xuất hiện dưới ba dạng trong nguồn: số 1, số 0, và **chuỗi "1"**
 * (5 tham số của `/access/domains/{realm}/sync`). Đọc thẳng làm boolean thì
 * số 0 sẽ thành `false` đúng, nhưng chuỗi "0" nếu có sẽ thành `true` — sai.
 */
function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value !== '' && value !== '0'
  return false
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** Sub-schema của property string dùng `default_key` để đánh dấu khoá viết được không cần tên. */
function normalizeParam(raw: unknown): PveParamSpec {
  if (!isObject(raw)) return {}

  const spec: PveParamSpec = {}

  const type = optString(raw['type'])
  if (type) spec.type = type as PveParamSpec['type']

  if ('optional' in raw) spec.optional = toBool(raw['optional'])
  if ('default_key' in raw) spec.defaultKey = toBool(raw['default_key'])

  const description = optString(raw['description'])
  if (description) spec.description = description

  const verbose = optString(raw['verbose_description'])
  if (verbose) spec.verboseDescription = verbose

  const typetext = optString(raw['typetext'])
  if (typetext) spec.typetext = typetext

  const formatDescription = optString(raw['format_description'])
  if (formatDescription) spec.formatDescription = formatDescription

  if ('default' in raw) spec.default = raw['default']

  const enumValues = raw['enum']
  if (Array.isArray(enumValues)) {
    spec.enum = enumValues.map((v) => String(v))
  }

  const format = raw['format']
  if (typeof format === 'string') {
    spec.format = format
  } else if (isObject(format)) {
    // Sub-schema nội tuyến của property string — đây là thứ cho phép sinh kiểu
    // cho net[n], scsi[n], virtio[n]… Giữ nguyên cả mục bí danh (alias/keyAlias)
    // để generator tự quyết bỏ qua; bỏ ở đây sẽ mất thông tin cho bộ parse.
    const nested: Record<string, PveParamSpec | { alias: string; keyAlias?: string }> = {}
    for (const [key, value] of Object.entries(format)) {
      if (isObject(value) && typeof value['alias'] === 'string') {
        const alias: { alias: string; keyAlias?: string } = { alias: value['alias'] }
        const keyAlias = optString(value['keyAlias'])
        if (keyAlias) alias.keyAlias = keyAlias
        nested[key] = alias
      } else {
        nested[key] = normalizeParam(value)
      }
    }
    spec.format = nested
  }

  const pattern = optString(raw['pattern'])
  if (pattern) spec.pattern = pattern

  const requires = optString(raw['requires'])
  if (requires) spec.requires = requires

  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength'] as const) {
    const value = optNumber(raw[key])
    if (value !== undefined) spec[key] = value
  }

  if ('items' in raw) spec.items = normalizeParam(raw['items'])

  if (isObject(raw['properties'])) {
    const props: Record<string, PveParamSpec> = {}
    for (const [key, value] of Object.entries(raw['properties'])) {
      props[key] = normalizeParam(value)
    }
    spec.properties = props
  }

  const oneOf = raw['oneOf']
  if (Array.isArray(oneOf)) {
    spec.oneOf = oneOf.map((v) => normalizeParam(v))
  }

  return spec
}

function normalizeReturns(raw: unknown): PveReturnSpec {
  const spec: PveReturnSpec = normalizeParam(raw)
  if (isObject(raw) && Array.isArray(raw['links'])) {
    const links: { href: string; rel: string }[] = []
    for (const link of raw['links']) {
      if (isObject(link) && typeof link['href'] === 'string' && typeof link['rel'] === 'string') {
        links.push({ href: link['href'], rel: link['rel'] })
      }
    }
    if (links.length > 0) spec.links = links
  }
  return spec
}

/** Lấy path param từ chính mẫu đường dẫn. Tên có thể chứa gạch ngang và gạch dưới. */
function extractPathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string)
}

function normalizeEndpoint(method: PveHttpMethod, raw: Json): PveEndpointMeta {
  const parameters = isObject(raw['parameters']) ? raw['parameters'] : {}
  const properties = isObject(parameters['properties']) ? parameters['properties'] : {}

  const params: Record<string, PveParamSpec> = {}
  for (const [name, spec] of Object.entries(properties)) {
    params[name] = normalizeParam(spec)
  }

  const meta: PveEndpointMeta = {
    name: optString(raw['name']) ?? method.toLowerCase(),
    method,
    allowToken: toBool(raw['allowtoken']),
    protected: toBool(raw['protected']),
    params,
    returns: normalizeReturns(raw['returns']),
  }

  const description = optString(raw['description'])
  if (description) meta.description = description

  const proxyTo = optString(raw['proxyto'])
  if (proxyTo) meta.proxyTo = proxyTo

  if ('download_allowed' in raw) meta.downloadAllowed = toBool(raw['download_allowed'])
  if ('permissions' in raw) meta.permissions = raw['permissions']

  return meta
}

function walk(node: unknown, paths: Record<string, PvePathEntry>): void {
  if (!isObject(node)) return

  const path = optString(node['path'])
  if (path) {
    const entry: PvePathEntry = {
      path,
      pathParams: extractPathParams(path),
      methods: {},
    }

    const info = isObject(node['info']) ? node['info'] : {}
    for (const method of HTTP_METHODS) {
      const raw = info[method]
      if (isObject(raw)) entry.methods[method] = normalizeEndpoint(method, raw)
    }

    if (paths[path]) {
      throw new Error(`Đường dẫn trùng lặp trong schema: ${path}`)
    }
    paths[path] = entry
  }

  const children = node['children']
  if (Array.isArray(children)) {
    for (const child of children) walk(child, paths)
  }
}

async function main(): Promise<void> {
  const source = await readFile(rawPath, 'utf8').catch(() => {
    throw new Error(`Không đọc được ${rawPath}. Chạy \`npm run fetch\` trước.`)
  })

  const tree = extractApiSchemaArray(source)

  const paths: Record<string, PvePathEntry> = {}
  for (const node of tree) walk(node, paths)

  const endpointCount = Object.values(paths).reduce(
    (sum, entry) => sum + Object.keys(entry.methods).length,
    0,
  )

  const schema: PveSchema = {
    pveVersion: PVE_VERSION,
    sourceUrl: SOURCE_URL,
    sourceSha256: createHash('sha256').update(source, 'utf8').digest('hex'),
    sourceBytes: Buffer.byteLength(source, 'utf8'),
    pathCount: Object.keys(paths).length,
    endpointCount,
    // Sắp xếp khoá để tệp sinh ra ổn định, diff giữa các lần cập nhật Proxmox
    // chỉ hiện đúng phần thật sự thay đổi.
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => (a < b ? -1 : 1))),
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(outPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')

  const tokenBlocked = Object.values(paths).flatMap((entry) =>
    Object.values(entry.methods)
      .filter((m) => !m.allowToken)
      .map((m) => `${m.method} ${entry.path}`),
  )

  console.log(`Đã ghi ${outPath}`)
  console.log(`  Đường dẫn:  ${schema.pathCount}`)
  console.log(`  Endpoint:   ${schema.endpointCount}`)
  console.log(`  Chặn token: ${tokenBlocked.length}`)
  for (const item of tokenBlocked) console.log(`    ${item}`)
}

await main()
