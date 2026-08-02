import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IpcChannel, type AuthEvent, type PveEvent } from '@pve/ipc'
import { installCsp } from './security/csp'
import { ConsoleRelayServer } from './console/relay-server'
import { registerConsoleHandlers } from './ipc/console.handlers'
import { registerPveHandlers } from './ipc/pve.handlers'
import { registerVaultHandlers } from './ipc/vault.handlers'
import { registerStreamHandlers } from './ipc/stream.handlers'
import { registerTransferHandlers } from './ipc/transfer.handlers'
import { E2ePlainEncryptor, SafeStorageEncryptor } from './security/encryptor'
import { Vault } from './security/vault'
import { ConnectionPool } from './pve/connection-pool'
import { ResourcePoller } from './pve/resource-poller'
import { TaskTracker } from './pve/task-tracker'
import { createMainWindow, installNavigationGuards, openExternalLink } from './window'

const isDev = !app.isPackaged
const relay = new ConsoleRelayServer()

/** Đẩy sự kiện tới mọi cửa sổ renderer (cửa sổ chính + console tách). */
function pushEvent(event: PveEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IpcChannel.PveEvent, event)
  }
}

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

  // Kho kết nối + connection pool. Vault nằm trong userData; secret mã hóa bằng
  // DPAPI (safeStorage), ticket/CSRF chỉ giữ trong bộ nhớ pool.
  // E2E headless: dùng plaintext encryptor vì libsecret thường không có.
  const encryptor = process.env['PVE_E2E_MOCK_URL']
    ? new E2ePlainEncryptor()
    : new SafeStorageEncryptor()
  const vault = new Vault(join(app.getPath('userData'), 'vault.json'), encryptor)
  const pool = new ConnectionPool(vault, (id, phase, message) => {
    pushEvent({ kind: 'auth', connectionId: id, phase: phase as AuthEvent['phase'], ...(message ? { message } : {}) })
  })

  // Poll /cluster/resources trong main để cây tài nguyên và dashboard cùng dùng
  // chung một nguồn, tiếp tục chạy cả khi cửa sổ thu nhỏ. Task tracker tự động
  // theo dõi mọi UPID mà pve.handlers thấy trả về — xem ghi chú trong file đó.
  const resourcePoller = new ResourcePoller(pool, (connectionId, resources, at) => {
    pushEvent({ kind: 'resources', connectionId, resources, at })
  })
  const taskTracker = new TaskTracker(pool, (connectionId, upid, event) => {
    if (event.kind === 'phase') {
      pushEvent({
        kind: 'task',
        connectionId,
        upid,
        phase: event.phase,
        ...(event.exitstatus ? { exitstatus: event.exitstatus } : {}),
      })
    } else {
      pushEvent({ kind: 'log-chunk', connectionId, upid, lines: event.lines })
    }
  })

  await relay.start()
  registerConsoleHandlers(relay, pool, pushEvent)
  registerPveHandlers(pool, taskTracker)
  registerVaultHandlers(vault, pool)
  registerStreamHandlers(resourcePoller)
  registerTransferHandlers(pool, taskTracker, (event) => pushEvent(event))
  registerAppHandlers()

  // Playwright / E2E: ghi vault trước khi mở cửa sổ để `refresh()` lúc mount thấy
  // connection; `pool.connect` chạy sau did-finish-load để sự kiện auth không mất.
  let e2eConnectionId: string | null = null
  const e2eMockUrl = process.env['PVE_E2E_MOCK_URL']
  if (e2eMockUrl) {
    try {
      const u = new URL(e2eMockUrl)
      e2eConnectionId = vault.upsert({
        name: 'e2e-mock',
        host: u.hostname,
        port: Number(u.port || 8006),
        authMode: 'ticket',
        username: process.env['PVE_E2E_USER'] ?? 'root@pam',
        password: process.env['PVE_E2E_PASSWORD'] ?? 'x',
        allowSelfSigned: true,
      }).id
    } catch (error) {
      console.error('PVE_E2E_MOCK_URL: không ghi được vault', error)
    }
  }

  app.on('will-quit', () => {
    pool.closeAll()
    resourcePoller.stopAll()
    taskTracker.stopAll()
  })

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const window = createMainWindow()

  if (e2eMockUrl && e2eConnectionId) {
    const connectionId = e2eConnectionId
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void pool.connect(connectionId).catch((error: unknown) => {
          console.error('PVE_E2E_MOCK_URL: không kết nối được mock', error)
        })
      }, 800)
    })
  }

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
