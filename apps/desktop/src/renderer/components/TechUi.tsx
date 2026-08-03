import { PVE_COLORS } from '../theme/tokens'

export type LedKind = 'online' | 'running' | 'stopped' | 'error' | 'warn' | 'info'

const CLASS_OF: Record<LedKind, string> = {
  online: 'led-online',
  running: 'led-running',
  stopped: 'led-stopped',
  error: 'led-error',
  warn: 'led-warn',
  info: 'led-info',
}

/** Đèn LED trạng thái kiểu mockup Hi-Tech. */
export function LedDot({
  kind,
  title,
}: {
  kind: LedKind
  title?: string
}): React.JSX.Element {
  return <span className={`led-indicator ${CLASS_OF[kind]}`} title={title} aria-hidden />
}

export function ledKindFromResourceStatus(opts: {
  type: string
  status?: string
}): LedKind {
  if (opts.type === 'node') return opts.status === 'online' ? 'online' : 'error'
  if (opts.type === 'qemu' || opts.type === 'lxc') {
    return opts.status === 'running' ? 'running' : 'stopped'
  }
  if (opts.type === 'storage') return opts.status === 'available' ? 'online' : 'warn'
  return 'info'
}

/** Donut SVG phần trăm cho dashboard gauges. */
export function TechDonut({
  percent,
  size = 88,
  stroke = 8,
  color = PVE_COLORS.info,
  label,
}: {
  percent: number
  size?: number
  stroke?: number
  color?: string
  label?: string
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <svg className="tech-donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(35, 47, 72, 0.9)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="rgba(255,255,255,0.92)"
        fontSize={size * 0.22}
        fontFamily="var(--pve-font-mono)"
      >
        {label ?? `${Math.round(pct)}%`}
      </text>
    </svg>
  )
}
