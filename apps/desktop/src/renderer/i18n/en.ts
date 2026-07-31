import type { TranslationSchema } from './vi'

/**
 * Bản tiếng Anh. Giữ cùng hình dạng với `vi` — kiểu `TranslationSchema` sẽ báo lỗi
 * biên dịch nếu thiếu khoá, nên không thể quên dịch một chuỗi nào.
 */
export const en: TranslationSchema = {
  app: {
    name: 'Proxmox VE',
    tagline: 'Virtualization management',
  },
  nav: {
    dashboard: 'Dashboard',
    console: 'Console',
    connections: 'Connections',
    settings: 'Settings',
  },
  dashboard: {
    title: 'Dashboard',
    noConnection: 'No connections yet',
    noConnectionHint:
      'Phase 2 adds multi-cluster connection management. For now you can try the simulated console to verify the technical plumbing.',
    openConsole: 'Open simulated console',
  },
  console: {
    title: 'Console',
    demoBadge: 'Simulated',
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Disconnected',
    failed: 'Connection failed',
    reconnect: 'Reconnect',
    clear: 'Clear screen',
    hint: 'Try typing multi-byte characters to verify UTF-8 framing.',
  },
  status: {
    running: 'Running',
    stopped: 'Stopped',
    paused: 'Paused',
    unknown: 'Unknown',
  },
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    close: 'Close',
    retry: 'Retry',
    loading: 'Loading…',
    error: 'Error',
    version: 'Version',
  },
  tasks: {
    dockTitle: 'Task log',
    empty: 'No tasks yet',
  },
}
