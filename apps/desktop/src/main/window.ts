import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

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
    webPreferences: {
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
    },
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
