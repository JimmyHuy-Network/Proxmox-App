/**
 * Bóc mảng schema ra khỏi `apidoc.js`.
 *
 * Tệp này KHÔNG phải JSON. Nó có dạng:
 *
 *     const apiSchema = [ ...4.2 MB dữ liệu... ]
 *     ;
 *     let method2cmd = { ... }
 *     Ext.onReady(function () { ...toàn bộ giao diện ExtJS của trang API viewer... })
 *
 * Nên không thể cắt theo ký tự cuối tệp — phải quét dấu ngoặc cân bằng để dừng đúng
 * chỗ mảng đóng lại. Có khoảng 22 KB mã JS nằm sau mảng.
 */
export function extractApiSchemaArray(source: string): unknown[] {
  const declaration = source.indexOf('const apiSchema')
  if (declaration < 0) {
    throw new Error('Không tìm thấy khai báo `const apiSchema` — định dạng apidoc.js đã đổi')
  }

  const start = source.indexOf('[', declaration)
  if (start < 0) {
    throw new Error('Không tìm thấy dấu [ mở mảng schema')
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '[' || ch === '{') {
      depth += 1
    } else if (ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        const parsed: unknown = JSON.parse(source.slice(start, i + 1))
        if (!Array.isArray(parsed)) {
          throw new Error('apiSchema không phải là mảng')
        }
        return parsed
      }
    }
  }

  throw new Error('Tệp kết thúc trước khi mảng schema đóng lại — có thể tải về bị cụt')
}
