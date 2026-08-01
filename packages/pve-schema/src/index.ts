import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PveEndpointMeta, PveHttpMethod, PvePathEntry, PveSchema } from './types.ts'

export * from './types.ts'
export { extractApiSchemaArray } from './extract.ts'

const here = dirname(fileURLToPath(import.meta.url))

export const SCHEMA_PATH = join(here, '..', 'generated', 'pve-9.2.schema.json')

let cached: PveSchema | null = null

/**
 * Nạp schema đã chuẩn hoá.
 *
 * Đọc từ đĩa thay vì `import` tệp JSON, để 2.3 MB này không bị gộp vào bundle của
 * ứng dụng desktop. Chỉ có bộ sinh mã và mock server cần tới nó — app desktop dùng
 * `endpoints.ts` sinh sẵn, vốn nhỏ hơn nhiều.
 */
export function loadSchema(): PveSchema {
  if (!cached) {
    cached = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as PveSchema
  }
  return cached
}

export function getPath(schema: PveSchema, path: string): PvePathEntry | undefined {
  return schema.paths[path]
}

export function getEndpoint(
  schema: PveSchema,
  path: string,
  method: PveHttpMethod,
): PveEndpointMeta | undefined {
  return schema.paths[path]?.methods[method]
}

/** Duyệt phẳng toàn bộ endpoint — dạng hay dùng nhất cho codegen và mock server. */
export function* iterateEndpoints(
  schema: PveSchema,
): Generator<{ path: string; entry: PvePathEntry; meta: PveEndpointMeta }> {
  for (const entry of Object.values(schema.paths)) {
    for (const meta of Object.values(entry.methods)) {
      yield { path: entry.path, entry, meta }
    }
  }
}
