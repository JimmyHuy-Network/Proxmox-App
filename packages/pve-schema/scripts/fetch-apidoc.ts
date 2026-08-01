import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractApiSchemaArray } from '../src/extract.ts'

/**
 * Tải schema API của Proxmox VE.
 *
 * Chạy tay, KHÔNG chạy trong build. Kết quả chuẩn hoá được commit vào git để
 * build không phụ thuộc mạng và để thấy rõ khi Proxmox đổi API.
 *
 *   node scripts/fetch-apidoc.ts [url]
 */

const DEFAULT_URL = 'https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js'

const here = dirname(fileURLToPath(import.meta.url))
const rawDir = join(here, '..', 'raw')

async function main(): Promise<void> {
  const url = process.argv[2] ?? DEFAULT_URL

  console.log(`Đang tải ${url} …`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Tải thất bại: HTTP ${response.status} ${response.statusText}`)
  }

  const source = await response.text()
  const bytes = Buffer.byteLength(source, 'utf8')
  const sha256 = createHash('sha256').update(source, 'utf8').digest('hex')

  // Kiểm tra bóc được ngay lúc tải, để lỗi lộ ra ở đây chứ không phải ở bước sau.
  const tree = extractApiSchemaArray(source)

  await mkdir(rawDir, { recursive: true })
  await writeFile(join(rawDir, 'apidoc.js'), source, 'utf8')
  await writeFile(
    join(rawDir, 'apidoc.meta.json'),
    `${JSON.stringify({ url, bytes, sha256, rootNodes: tree.length }, null, 2)}\n`,
    'utf8',
  )

  console.log(`Đã lưu raw/apidoc.js — ${bytes.toLocaleString('vi-VN')} byte`)
  console.log(`sha256: ${sha256}`)
  console.log(`Nhánh gốc: ${tree.length}`)
  console.log('Bước tiếp theo: npm run normalize')
}

await main()
