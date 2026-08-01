declare const upidBrand: unique symbol

/**
 * Định danh tác vụ của Proxmox.
 *
 * Là chuỗi, nhưng gắn nhãn riêng để không lẫn với chuỗi thường: endpoint nào trả về
 * `Upid` là endpoint khởi động một tác vụ chạy nền, và bên gọi phải theo dõi nó chứ
 * không được coi như đã xong.
 */
export type Upid = string & { readonly [upidBrand]: true }

export interface ParsedUpid {
  raw: Upid
  node: string
  pid: number
  pstart: number
  startTime: Date
  /** Loại tác vụ, ví dụ `qmstart`, `vzdump`, `qmclone`, `imgdel`. */
  type: string
  /** Tài nguyên đích — thường là vmid, nhưng có thể là tên storage hoặc chuỗi rỗng. */
  id: string
  user: string
}

/**
 * Cấu trúc: `UPID:node:PID:PSTART:STARTTIME:TYPE:ID:USER@REALM:`
 *
 * PID, PSTART và STARTTIME là hex. STARTTIME là Unix epoch tính theo giây.
 *
 * Phân tích được chuỗi này là cách biết node, loại tác vụ và tài nguyên đích **mà
 * không cần gọi thêm API** — đó chính là cách suy ra query key nào cần làm mới khi
 * tác vụ kết thúc.
 *
 * Lưu ý `id` có thể chứa dấu hai chấm (tên storage), nên không tách bằng split đơn thuần.
 */
const UPID_PATTERN =
  /^UPID:([^:]+):([0-9A-Fa-f]+):([0-9A-Fa-f]+):([0-9A-Fa-f]+):([^:]+):(.*):([^:]+):$/

export function parseUpid(value: string): ParsedUpid | null {
  const match = UPID_PATTERN.exec(value)
  if (!match) return null

  const [, node, pidHex, pstartHex, startHex, type, id, user] = match

  return {
    raw: value as Upid,
    node: node as string,
    pid: Number.parseInt(pidHex as string, 16),
    pstart: Number.parseInt(pstartHex as string, 16),
    startTime: new Date(Number.parseInt(startHex as string, 16) * 1000),
    type: type as string,
    id: id as string,
    user: user as string,
  }
}

export function isUpid(value: unknown): value is Upid {
  return typeof value === 'string' && UPID_PATTERN.test(value)
}

/**
 * Suy ra loại tài nguyên mà tác vụ này tác động, để biết phần nào của bộ nhớ đệm
 * cần làm mới. Trả về `null` khi không suy được và bên gọi nên làm mới rộng hơn.
 */
export function upidResourceKind(parsed: ParsedUpid): 'qemu' | 'lxc' | 'storage' | 'node' | null {
  const { type } = parsed

  if (type.startsWith('qm') || type === 'vncproxy' || type === 'spiceproxy') return 'qemu'
  if (type.startsWith('vz') && type !== 'vzdump') return 'lxc'
  if (type.startsWith('pct')) return 'lxc'
  if (type === 'vzdump') return /^\d+$/.test(parsed.id) ? 'qemu' : 'storage'
  if (type.startsWith('imgdel') || type.startsWith('download')) return 'storage'
  if (type.startsWith('srv') || type.startsWith('apt') || type.startsWith('startall')) return 'node'

  return null
}
