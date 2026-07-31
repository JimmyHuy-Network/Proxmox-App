import { app, BrowserWindow, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IpcChannel } from '@pve/ipc'
import { installCsp } from './security/csp'
import { ConsoleRelayServer } from './console/relay-server'
import { registerConsoleHandlers } from './ipc/console.handlers'
import { createMainWindow, installNavigationGuards, openExternalLink } from './window'

const isDev = !app.isPackaged
const relay = new ConsoleRelayServer()

// Một tiến trình duy nhất: mở app lần hai sẽ dựng lại cửa sổ đang có thay vì tạo
// tiến trình mới. Quan trọng vì main giữ trạng thái xác thực và các poller.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  electronApp.setAppUserModelId('com.proxmoxapp.desktop')
  installNavigationGuards()
  installCsp(process.env['ELECTRON_RENDERER_URL'])

  await relay.start()
  registerConsoleHandlers(relay)
  registerAppHandlers()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const window = createMainWindow()

  if (process.env['PVE_SMOKE_TEST'] === '1') runSmokeTest(window)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

/**
 * Khởi động app, thu mọi lỗi và cảnh báo của renderer, rồi thoát với mã trạng thái.
 *
 * Tồn tại vì tiêu chí "console không có vi phạm CSP nào" phải kiểm được tự động —
 * nếu phải mở DevTools nhìn bằng mắt thì sẽ không ai kiểm, và một CSP bị nới lỏng
 * sẽ lọt qua mà không ai biết. Chạy: `PVE_SMOKE_TEST=1 electron .`
 */
function runSmokeTest(window: BrowserWindow): void {
  const problems: string[] = []

  // level: 0=verbose 1=info 2=warning 3=error
  window.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') {
      problems.push(`[${event.level}] ${event.message}`)
    }
  })

  window.webContents.on('did-fail-load', (_e, code, description) => {
    problems.push(`[nạp thất bại] ${code} ${description}`)
  })

  window.webContents.once('did-finish-load', () => {
    // Cho React kịp mount và cho mọi vi phạm CSP kịp nổ ra.
    setTimeout(() => {
      if (problems.length > 0) {
        console.error(`SMOKE TEST THẤT BẠI — ${problems.length} vấn đề:`)
        for (const problem of problems) console.error(`  ${problem}`)
        app.exit(1)
        return
      }
      console.log('SMOKE TEST ĐẠT — renderer nạp xong, không có cảnh báo hay lỗi nào')
      app.exit(0)
    }, 3000)
  })
}

function registerAppHandlers(): void {
  ipcMain.handle(IpcChannel.App, async (_event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'Lệnh không hợp lệ' }
    const cmd = raw as Record<string, unknown>

    switch (cmd['action']) {
      case 'getVersion':
        return { ok: true, data: { app: app.getVersion(), electron: process.versions.electron } }

      case 'openExternal': {
        const url = cmd['url']
        if (typeof url !== 'string') return { ok: false, message: 'Thiếu URL' }
        const opened = await openExternalLink(url)
        return opened ? { ok: true, data: null } : { ok: false, message: 'URL không được phép mở' }
      }

      case 'isDev':
        return { ok: true, data: isDev }

      default:
        return { ok: false, message: 'Hành động không hỗ trợ' }
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  relay.stop()
})
