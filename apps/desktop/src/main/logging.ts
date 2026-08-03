import { app, dialog, type WebContents } from 'electron'
import log from 'electron-log/main'
import { join } from 'node:path'

/** Tối đa 3 lần reload trong 60s cho cùng webContents — quá thì hiện dialog và thoát. */
const RELOAD_WINDOW_MS = 60_000
const RELOAD_MAX = 3
const reloadStamps = new WeakMap<WebContents, number[]>()

/**
 * Logging + crash hooks (GĐ 9).
 *
 * Dùng electron-log (file trong userData/logs) thay vì Sentry — đủ để thu thập
 * lỗi khi hỗ trợ người dùng, không phụ thuộc dịch vụ bên ngoài.
 */
export function installLogging(): typeof log {
  log.initialize()
  log.transports.file.level = 'info'
  log.transports.console.level = app.isPackaged ? 'warn' : 'debug'
  log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')

  // Ghi đè console.* của main sang electron-log.
  Object.assign(console, log.functions)

  process.on('uncaughtException', (error) => {
    log.error('uncaughtException', error)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason)
  })

  app.on('render-process-gone', (_event, webContents, details) => {
    log.error('render-process-gone', details)
    if (details.reason !== 'crashed' && details.reason !== 'oom') return
    if (webContents.isDestroyed()) return

    const now = Date.now()
    const recent = (reloadStamps.get(webContents) ?? []).filter((t) => now - t < RELOAD_WINDOW_MS)
    if (recent.length >= RELOAD_MAX) {
      void dialog
        .showMessageBox({
          type: 'error',
          title: 'Renderer crashed',
          message: 'Cửa sổ ứng dụng bị crash liên tiếp và sẽ đóng.',
          detail: `reason=${details.reason} exitCode=${details.exitCode}`,
          buttons: ['OK'],
        })
        .then(() => {
          app.quit()
        })
      return
    }

    recent.push(now)
    reloadStamps.set(webContents, recent)
    log.warn('render-process-gone: reloading renderer', { attempt: recent.length, reason: details.reason })
    webContents.reload()
  })
  app.on('child-process-gone', (_event, details) => {
    log.error('child-process-gone', details)
  })

  log.info('logging ready', { version: app.getVersion(), packaged: app.isPackaged })
  return log
}

export function getLogDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

export { log }
