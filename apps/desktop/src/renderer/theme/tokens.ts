/** Design tokens cho giao diện Modern Hi-Tech (bám docs/ui-mockups). */
export const PVE_COLORS = {
  bgBase: '#0b0f19',
  bgContainer: '#121826',
  bgElevated: '#182032',
  primary: '#ff6b00',
  info: '#00f2fe',
  success: '#00f5a0',
  error: '#ff4d6d',
  warning: '#ffb020',
  border: '#232f48',
  borderSecondary: '#1b253b',
  cyanGlow: 'rgba(0, 242, 254, 0.25)',
  /** Đồng bộ với `--pve-cyan-border` trong styles.css */
  cyanBorder: 'rgba(0, 242, 254, 0.22)',
} as const

export const pveAntdToken = {
  colorBgBase: PVE_COLORS.bgBase,
  colorBgContainer: PVE_COLORS.bgContainer,
  colorBgElevated: PVE_COLORS.bgElevated,
  colorBgLayout: PVE_COLORS.bgBase,
  colorPrimary: PVE_COLORS.primary,
  colorInfo: PVE_COLORS.info,
  colorSuccess: PVE_COLORS.success,
  colorError: PVE_COLORS.error,
  colorWarning: PVE_COLORS.warning,
  colorBorder: PVE_COLORS.border,
  colorBorderSecondary: PVE_COLORS.borderSecondary,
  borderRadius: 8,
  borderRadiusLG: 10,
  borderRadiusSM: 6,
  fontSize: 13,
  fontFamilyCode: '"JetBrains Mono", "Cascadia Mono", "Consolas", "SF Mono", monospace',
} as const
