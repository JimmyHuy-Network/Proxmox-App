import type { UpdateStatus } from '@pve/ipc'

/**
 * Phân loại lỗi electron-updater: thiếu publish / feed / release → `disabled`,
 * còn lại → `error` để UI hiện rõ.
 */
export function classifyUpdateError(message: string): UpdateStatus {
  if (
    /publish|No update|ERR_UPDATER|latest\.yml|app-update\.yml|dev-app-update|ENOENT|404|401|403|No published|not found|private|Unable to find|Cannot check for updates/i.test(
      message,
    )
  ) {
    return { state: 'disabled', reason: message.slice(0, 200) }
  }
  return { state: 'error', message }
}
