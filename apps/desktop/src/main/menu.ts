import { Menu, BrowserWindow, type MenuItemConstructorOptions, app } from 'electron'

/**
 * Application menu + phím tắt (GĐ 9).
 *
 * Dùng Menu accelerators (không globalShortcut) — tôn trọng focus cửa sổ và
 * autoHideMenuBar hiện tại. Renderer nhận lệnh qua IPC `app:misc` action `shortcut`.
 */
function sendShortcut(action: string): void {
  const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!focused) return
  focused.webContents.send('app:shortcut', { action })
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendShortcut('settings'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendShortcut('nav:/'),
        },
        {
          label: 'Connections',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendShortcut('nav:/connections'),
        },
        {
          label: 'Access',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendShortcut('nav:/access'),
        },
        {
          label: 'Firewall',
          accelerator: 'CmdOrCtrl+4',
          click: () => sendShortcut('nav:/firewall'),
        },
        {
          label: 'Datacenter',
          accelerator: 'CmdOrCtrl+5',
          click: () => sendShortcut('nav:/datacenter'),
        },
        { type: 'separator' },
        {
          label: 'Focus search',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendShortcut('search'),
        },
        {
          label: 'Refresh',
          accelerator: 'F5',
          click: () => sendShortcut('refresh'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' as const }] : [])],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => sendShortcut('shortcuts'),
        },
        {
          label: 'About',
          click: () => sendShortcut('about'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
