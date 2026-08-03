import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IpcChannel, type UpdateStatus } from '@pve/ipc'
import { log } from './logging'
import { classifyUpdateError } from './updater-errors'

export { classifyUpdateError } from './updater-errors'

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
 * - Packaged + `publish` GitHub trong electron-builder → check sau 5s, auto-download.
 * - Dev: mặc định `disabled` (reason `dev`).
 * - Dev có `PVE_UPDATE_URL` (generic feed) → bật kiểm thử UI/updater mà không đóng gói.
 */
export function installUpdater(isPackaged: boolean): void {
  const feedUrl = process.env['PVE_UPDATE_URL']?.trim()

  if (!isPackaged && !feedUrl) {
    status = { state: 'disabled', reason: 'dev' }
    return
  }

  if (wired) return
  wired = true

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  if (feedUrl) {
    // Generic server (local static / R2 / CDN) — ghi đè feed từ app-update.yml.
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl.replace(/\/$/, '') })
    if (!isPackaged) {
      autoUpdater.forceDevUpdateConfig = true
    }
    log.info('updater feed override', { url: feedUrl, packaged: isPackaged })
  }

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
    pushStatus(classifyUpdateError(message))
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
  if (status.state === 'disabled' && status.reason === 'dev') return status
  try {
    pushStatus({ state: 'checking' })
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushStatus(classifyUpdateError(message))
  }
  return status
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
