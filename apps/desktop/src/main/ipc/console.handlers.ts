import { BrowserWindow, ipcMain } from 'electron'
import {
  DEMO_CONNECTION_ID,
  IpcChannel,
  type ConsoleOpenRequest,
  type ConsoleOpenResult,
  type PveEvent,
} from '@pve/ipc'
import { createFakeShellSession } from '../console/demo-session'
import type { ConsoleRelayServer } from '../console/relay-server'
import { openSpiceViewer } from '../console/spice'
import { fetchSpiceConfig, openUpstreamConsole } from '../console/upstream-session'
import type { ConnectionPool } from '../pve/connection-pool'
import { createConsoleWindow } from '../window'

type ConsoleCommand =
  | { action: 'open'; request: ConsoleOpenRequest; detach?: boolean }
  | { action: 'close'; sessionId: string }
  | { action: 'openSpice'; request: ConsoleOpenRequest }

export type ConsoleReply =
  | { ok: true; data: ConsoleOpenResult | { path: string } | null }
  | { ok: false; message: string }

function parseCommand(value: unknown): ConsoleCommand | null {
  if (typeof value !== 'object' || value === null) return null
  const cmd = value as Record<string, unknown>

  if (cmd['action'] === 'close') {
    return typeof cmd['sessionId'] === 'string' ? { action: 'close', sessionId: cmd['sessionId'] } : null
  }

  if (cmd['action'] !== 'open' && cmd['action'] !== 'openSpice') return null

  const req = cmd['request']
  if (typeof req !== 'object' || req === null) return null
  const r = req as Record<string, unknown>

  if (typeof r['connectionId'] !== 'string') return null
  if (r['kind'] !== 'vnc' && r['kind'] !== 'term' && r['kind'] !== 'spice') return null
  if (typeof r['node'] !== 'string') return null
  if (r['vmid'] !== undefined && typeof r['vmid'] !== 'number') return null
  if (r['vmtype'] !== undefined && r['vmtype'] !== 'qemu' && r['vmtype'] !== 'lxc') return null

  const request: ConsoleOpenRequest = {
    connectionId: r['connectionId'],
    kind: r['kind'],
    node: r['node'],
    ...(typeof r['vmid'] === 'number' ? { vmid: r['vmid'] } : {}),
    ...(r['vmtype'] === 'qemu' || r['vmtype'] === 'lxc' ? { vmtype: r['vmtype'] } : {}),
  }

  if (cmd['action'] === 'openSpice') return { action: 'openSpice', request }

  return {
    action: 'open',
    request,
    ...(cmd['detach'] === true ? { detach: true } : {}),
  }
}

export function registerConsoleHandlers(
  relay: ConsoleRelayServer,
  pool: ConnectionPool,
  pushEvent: (event: PveEvent) => void,
): void {
  ipcMain.handle(IpcChannel.Console, async (_event, raw: unknown): Promise<ConsoleReply> => {
    const cmd = parseCommand(raw)
    if (!cmd) return { ok: false, message: 'Lệnh console không hợp lệ' }

    if (cmd.action === 'close') {
      return { ok: true, data: null }
    }

    if (cmd.action === 'openSpice') {
      return openSpice(pool, cmd.request)
    }

    // action === 'open'
    const { request, detach } = cmd
    if (request.kind === 'spice') {
      return openSpice(pool, request)
    }

    if (request.connectionId === DEMO_CONNECTION_ID) {
      const result = openDemoSession(relay, request)
      if (detach) openDetached(result)
      return { ok: true, data: result }
    }

    try {
      const result = await openRealSession(relay, pool, request, pushEvent)
      if (detach) openDetached(result)
      return { ok: true, data: result }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Không mở được console',
      }
    }
  })
}

async function openSpice(pool: ConnectionPool, request: ConsoleOpenRequest): Promise<ConsoleReply> {
  if (request.connectionId === DEMO_CONNECTION_ID) {
    return { ok: false, message: 'SPICE không dùng được với kết nối giả lập' }
  }
  try {
    await pool.request(request.connectionId, 'GET', '/version', {})
    if (!pool.consoleEndpoint(request.connectionId)) {
      return { ok: false, message: 'Kết nối chưa sẵn sàng' }
    }

    const spice = await fetchSpiceConfig(
      (method, path, params) => pool.request(request.connectionId, method, path, params),
      request,
    )
    const title =
      request.vmid !== undefined
        ? `${request.node} — ${request.vmtype === 'lxc' ? 'CT' : 'VM'} ${request.vmid} (SPICE)`
        : `${request.node} — SPICE shell`
    const { path } = await openSpiceViewer(spice, title)
    return { ok: true, data: { path } }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Không mở được SPICE',
    }
  }
}

function openDemoSession(
  relay: ConsoleRelayServer,
  request: ConsoleOpenRequest,
): ConsoleOpenResult {
  const title = `${request.node} — shell giả lập`
  const { sessionId, relayUrl } = relay.createSession(createFakeShellSession(title))
  return { sessionId, relayUrl, kind: request.kind === 'spice' ? 'term' : request.kind, title }
}

async function openRealSession(
  relay: ConsoleRelayServer,
  pool: ConnectionPool,
  request: ConsoleOpenRequest,
  pushEvent: (event: PveEvent) => void,
): Promise<ConsoleOpenResult> {
  await pool.request(request.connectionId, 'GET', '/version', {})
  const endpoint = pool.consoleEndpoint(request.connectionId)
  if (!endpoint) throw new Error('Kết nối chưa sẵn sàng cho console')

  // sessionId chưa có khi tạo upstream — giữ ô để hook đóng điền sau.
  const sessionRef = { id: '' }

  const { session, title } = await openUpstreamConsole({
    request: (method, path, params) => pool.request(request.connectionId, method, path, params),
    endpoint,
    open: request,
    hooks: {
      onClosed(reason, message) {
        if (!sessionRef.id) return
        pushEvent({
          kind: 'console-closed',
          sessionId: sessionRef.id,
          reason,
          ...(message ? { message } : {}),
        })
      },
    },
  })

  const { sessionId, relayUrl } = relay.createSession(session)
  sessionRef.id = sessionId

  return { sessionId, relayUrl, kind: request.kind, title }
}

function openDetached(result: ConsoleOpenResult): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.getTitle() === result.title && !win.isDestroyed()) {
      win.focus()
      return
    }
  }
  createConsoleWindow({
    sessionId: result.sessionId,
    relayUrl: result.relayUrl,
    kind: result.kind,
    title: result.title,
  })
}
