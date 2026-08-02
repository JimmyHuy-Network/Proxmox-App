/**
 * Giao thức termproxy của Proxmox VE.
 *
 * Giao thức này **bất đối xứng**, và đó là lý do không dùng được `@xterm/addon-attach`:
 *
 *   client → server   đóng khung:
 *       `0:<số byte>:<dữ liệu>`   gõ phím / dán
 *       `1:<cols>:<rows>:`        báo đổi kích thước
 *       `2`                       giữ nhịp (server ngắt sau 5 phút im lặng)
 *
 *   server → client   byte thô, không đóng khung.
 *
 * `@xterm/addon-attach` nối thô cả hai chiều nên sẽ làm hỏng chiều gửi.
 *
 * CẠM BẪY QUAN TRỌNG: `<số byte>` là **số byte UTF-8**, không phải `String.length`
 * của JavaScript. Chuỗi "ằ" có length 1 nhưng chiếm 3 byte; emoji có length 2 nhưng
 * chiếm 4 byte. Tính nhầm chỗ này thì gõ tiếng Việt có dấu sẽ vỡ ký tự — và triệu
 * chứng chỉ xuất hiện lúc gõ, rất khó lần ra nếu chỉ test bằng tiếng Anh.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const BYTE_COLON = 0x3a

export type TermFrame =
  | { type: 'data'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }

/** Đóng khung dữ liệu người dùng gõ. Độ dài tính theo byte UTF-8. */
export function encodeTermData(data: string): string {
  return `0:${encoder.encode(data).length}:${data}`
}

/** Báo cho server biết terminal đã đổi kích thước. Dấu hai chấm cuối là bắt buộc. */
export function encodeTermResize(cols: number, rows: number): string {
  return `1:${cols}:${rows}:`
}

/** Khung giữ nhịp. Gửi mỗi 30 giây để không chạm ngưỡng ngắt 5 phút của server. */
export const TERM_PING = '2'

function indexOfByte(buf: Uint8Array, byte: number, from: number): number {
  for (let i = from; i < buf.length; i += 1) {
    if (buf[i] === byte) return i
  }
  return -1
}

function parseIntFrom(buf: Uint8Array, start: number, end: number): number | null {
  const text = decoder.decode(buf.subarray(start, end))
  if (!/^\d+$/.test(text)) return null
  const value = Number.parseInt(text, 10)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Giải mã một khung phía server. Dùng cho fake shell và cho mock server.
 *
 * Nhận `Uint8Array` chứ không nhận `string`: phải cắt phần thân theo đúng số **byte**,
 * mà cắt byte trên chuỗi JavaScript thì không làm được cho ký tự nhiều byte.
 *
 * Trả về `null` nếu khung dị dạng hoặc chưa đủ dữ liệu — bên gọi nên bỏ qua, không ném lỗi.
 */
export function decodeTermFrame(raw: Uint8Array): TermFrame | null {
  if (raw.length === 0) return null

  // Ping gửi trần, không có dấu hai chấm nào.
  if (raw.length === 1 && raw[0] === 0x32) return { type: 'ping' }

  const firstColon = indexOfByte(raw, BYTE_COLON, 0)
  if (firstColon < 0) return null

  const kind = decoder.decode(raw.subarray(0, firstColon))

  if (kind === '0') {
    const secondColon = indexOfByte(raw, BYTE_COLON, firstColon + 1)
    if (secondColon < 0) return null

    const byteLength = parseIntFrom(raw, firstColon + 1, secondColon)
    if (byteLength === null) return null

    const bodyStart = secondColon + 1
    // Khung bị cắt giữa chừng — chờ thêm dữ liệu thay vì giải mã nửa ký tự.
    if (bodyStart + byteLength > raw.length) return null

    return { type: 'data', data: decoder.decode(raw.subarray(bodyStart, bodyStart + byteLength)) }
  }

  if (kind === '1') {
    const secondColon = indexOfByte(raw, BYTE_COLON, firstColon + 1)
    if (secondColon < 0) return null
    const thirdColon = indexOfByte(raw, BYTE_COLON, secondColon + 1)
    const rowsEnd = thirdColon < 0 ? raw.length : thirdColon

    const cols = parseIntFrom(raw, firstColon + 1, secondColon)
    const rows = parseIntFrom(raw, secondColon + 1, rowsEnd)
    if (cols === null || rows === null) return null

    return { type: 'resize', cols, rows }
  }

  return null
}

/** Tiện ích cho test và cho bên gọi đang cầm chuỗi. */
export function decodeTermFrameFromString(raw: string): TermFrame | null {
  return decodeTermFrame(encoder.encode(raw))
}
