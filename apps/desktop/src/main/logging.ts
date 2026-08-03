import { app } from 'electron'
import log from 'electron-log/main'
import { join } from 'node:path'

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

  app.on('render-process-gone', (_event, _webContents, details) => {
    log.error('render-process-gone', details)
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
