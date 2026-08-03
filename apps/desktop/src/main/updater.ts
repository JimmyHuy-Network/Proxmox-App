import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IpcChannel, type UpdateStatus } from '@pve/ipc'
import { log } from './logging'

let status: UpdateStatus = { state: 'idle' }
let wired = false

function pushStatus(next: UpdateStatus): void {
  status = next
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IpcChannel.PveEvent, { kind: 'update', status: next })
  }
}

/**
 * Auto-update qua electron-updater (GĐ 9).
 *
 * Chỉ chạy khi app đã đóng gói và `publish` được cấu hình trong electron-builder.
 * Dev / bản chưa publish → trạng thái `disabled`.
 */
export function installUpdater(isPackaged: boolean): void {
  if (!isPackaged) {
    status = { state: 'disabled', reason: 'dev' }
    return
  }

  if (wired) return
  wired = true

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => pushStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    pushStatus({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    pushStatus({ state: 'not-available', version: info.version })
  })
  autoUpdater.on('download-progress', (p) => {
    pushStatus({ state: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    pushStatus({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/publish|No update|ERR_UPDATER|latest\.yml|404/i.test(message)) {
      pushStatus({ state: 'disabled', reason: message.slice(0, 200) })
    } else {
      pushStatus({ state: 'error', message })
    }
    log.error('autoUpdater', error)
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.warn('checkForUpdates failed', error)
    })
  }, 5_000)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdatesNow(): Promise<UpdateStatus> {
  if (status.state === 'disabled') return status
  try {
    pushStatus({ state: 'checking' })
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushStatus({ state: 'error', message })
  }
  return status
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
