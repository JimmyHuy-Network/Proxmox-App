import { ipcMain } from 'electron'
import {
  DEMO_CONNECTION_ID,
  IpcChannel,
  type ConsoleOpenRequest,
  type ConsoleOpenResult,
} from '@pve/ipc'
import { createFakeShellSession } from '../console/demo-session'
import type { ConsoleRelayServer } from '../console/relay-server'

type ConsoleCommand =
  | { action: 'open'; request: ConsoleOpenRequest }
  | { action: 'close'; sessionId: string }

export type ConsoleReply =
  | { ok: true; data: ConsoleOpenResult | null }
  | { ok: false; message: string }

/**
 * Renderer là bên không đáng tin. Mọi thứ đi qua IPC đều phải kiểm tra hình dạng
 * trước khi dùng — `ipcMain.handle` sẽ vui vẻ giao cho ta bất cứ giá trị nào.
 */
function parseCommand(value: unknown): ConsoleCommand | null {
  if (typeof value !== 'object' || value === null) return null
  const cmd = value as Record<string, unknown>

  if (cmd['action'] === 'close') {
    return typeof cmd['sessionId'] === 'string' ? { action: 'close', sessionId: cmd['sessionId'] } : null
  }

  if (cmd['action'] !== 'open') return null

  const req = cmd['request']
  if (typeof req !== 'object' || req === null) return null
  const r = req as Record<string, unknown>

  if (typeof r['connectionId'] !== 'string') return null
  if (r['kind'] !== 'vnc' && r['kind'] !== 'term' && r['kind'] !== 'spice') return null
  if (typeof r['node'] !== 'string') return null
  if (r['vmid'] !== undefined && typeof r['vmid'] !== 'number') return null
  if (r['vmtype'] !== undefined && r['vmtype'] !== 'qemu' && r['vmtype'] !== 'lxc') return null

  return {
    action: 'open',
    request: {
      connectionId: r['connectionId'],
      kind: r['kind'],
      node: r['node'],
      ...(typeof r['vmid'] === 'number' ? { vmid: r['vmid'] } : {}),
      ...(r['vmtype'] === 'qemu' || r['vmtype'] === 'lxc' ? { vmtype: r['vmtype'] } : {}),
    },
  }
}

export function registerConsoleHandlers(relay: ConsoleRelayServer): void {
  ipcMain.handle(IpcChannel.Console, async (_event, raw: unknown): Promise<ConsoleReply> => {
    const cmd = parseCommand(raw)
    if (!cmd) return { ok: false, message: 'Lệnh console không hợp lệ' }

    if (cmd.action === 'close') {
      // Đóng phiên do relay tự xử lý khi socket phía renderer đóng lại.
      return { ok: true, data: null }
    }

    const { request } = cmd

    if (request.connectionId === DEMO_CONNECTION_ID) {
      // Phiên giả lập chạy được cả trong bản đóng gói vì nó hoàn toàn vô hại:
      // fake shell là một bộ thông dịch trong tiến trình, không đọc ghi file,
      // không mở kết nối ra ngoài, và relay chỉ lắng nghe trên loopback với
      // token dùng một lần.
      //
      // GỠ BỎ ở giai đoạn 2, khi phần quản lý kết nối thật đã có và người dùng
      // không còn cần một môi trường thử nghiệm sẵn trong app nữa.
      return { ok: true, data: openDemoSession(relay, request) }
    }

    // Giai đoạn 2 nối vào connection pool thật; giai đoạn 5 nối vào /vncproxy và /termproxy.
    return { ok: false, message: 'Chưa có kết nối Proxmox nào được cấu hình' }
  })
}

function openDemoSession(
  relay: ConsoleRelayServer,
  request: ConsoleOpenRequest,
): ConsoleOpenResult {
  const title = `${request.node} — shell giả lập`
  const { sessionId, relayUrl } = relay.createSession(createFakeShellSession(title))
  return { sessionId, relayUrl, kind: request.kind, title }
}
