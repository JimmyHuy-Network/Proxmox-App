import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import type { ConsoleKind } from '@pve/ipc'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

const SECURE_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  // Bốn dòng dưới đây là ranh giới bảo mật chính. Đừng nới bất kỳ dòng nào.
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
} as const

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141414',
    title: 'Proxmox VE',
    webPreferences: { ...SECURE_WEB_PREFERENCES },
  })

  // Chỉ hiện khi đã vẽ xong, tránh chớp nền trắng.
  window.once('ready-to-show', () => window.show())

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

export interface ConsoleWindowOptions {
  sessionId: string
  relayUrl: string
  kind: ConsoleKind
  title: string
}

/**
 * Cửa sổ console tách rời. Mở từ main (không phải window.open) vì
 * `setWindowOpenHandler` chặn mọi popup từ renderer.
 *
 * Hash route `#/console/session?...` mang relayUrl đã cấp — renderer chỉ nối
 * loopback, không thấy host/ticket Proxmox.
 */
export function createConsoleWindow(opts: ConsoleWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1024,
    height: 700,
    minWidth: 640,
    minHeight: 400,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: opts.title,
    webPreferences: { ...SECURE_WEB_PREFERENCES },
  })

  const params = new URLSearchParams({
    sessionId: opts.sessionId,
    relayUrl: opts.relayUrl,
    kind: opts.kind,
    title: opts.title,
  })
  // Hash history: `#/path?query` — không dùng search của http URL (TanStack Router
  // hash history đọc query trong phần hash).
  const hash = `/console/session?${params.toString()}`

  window.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('Console window failed to load:', code, desc)
  })

  if (DEV_SERVER_URL) {
    const base = DEV_SERVER_URL.replace(/\/$/, '')
    void window.loadURL(`${base}/#${hash}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }

  window.focus()
  return window
}

/**
 * Chặn mọi đường mà nội dung web có thể lái renderer đi chỗ khác.
 *
 * Tên VM, ghi chú, dòng log của Proxmox đều là dữ liệu do người khác nhập; nếu
 * một trong số đó lọt vào DOM dưới dạng thẻ neo thì không có mấy hàng rào này
 * nó sẽ điều hướng được cả cửa sổ.
 */
export function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const allowed = DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://')
      if (!allowed) event.preventDefault()
    })

    // Không mở cửa sổ mới từ nội dung web. Link ngoài đi qua IPC có kiểm duyệt.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))

    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/** Danh sách trắng cho việc mở link ra trình duyệt hệ thống. */
const ALLOWED_EXTERNAL_HOSTS = new Set(['pve.proxmox.com', 'www.proxmox.com', 'forum.proxmox.com'])

export async function openExternalLink(rawUrl: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  if (!ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) return false

  await shell.openExternal(url.toString())
  return true
}
