import { useEffect, useMemo, useRef, useState } from 'react'
import UplotReact from 'uplot-react'
import 'uplot/dist/uPlot.min.css'
import type { AlignedData, Options } from 'uplot'
import { Empty, theme } from 'antd'

export interface RrdSeries {
  key: string
  label: string
  color: string
  /** Định dạng giá trị hiển thị trên trục Y và trong tooltip. */
  format?: (value: number) => string
}

/**
 * Biểu đồ thời gian cho dữ liệu RRD, bọc uPlot.
 *
 * Chọn uPlot thay vì thư viện SVG (Recharts…) vì RRD hiển thị nhiều panel đồng bộ
 * mỗi guest/node, mỗi panel tới 70 điểm; uPlot vẽ canvas trong khoảng 1 ms mỗi
 * panel, còn SVG bắt đầu giật ở quy mô đó.
 *
 * uPlot đòi hỏi chiều rộng tính bằng pixel tường minh, không tự co giãn — nên phải
 * tự đo container bằng ResizeObserver, cùng cơ chế với `FitAddon` của xterm.js ở
 * `TerminalPane`.
 */
export function RrdChart({
  points,
  series,
  height = 160,
}: {
  points: Record<string, number>[]
  series: RrdSeries[]
  height?: number
}): React.JSX.Element {
  const { token } = theme.useToken()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.floor(w))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const data = useMemo<AlignedData>(() => {
    const xs = points.map((p) => p['time'] ?? 0)
    const ys = series.map((s) => points.map((p) => (typeof p[s.key] === 'number' ? p[s.key] : null)))
    return [xs, ...ys] as AlignedData
  }, [points, series])

  const options = useMemo<Options>(() => {
    const span = points.length > 1 ? (points.at(-1)?.['time'] ?? 0) - (points[0]?.['time'] ?? 0) : 0
    const showDate = span > 2 * 86400 // hơn 2 ngày thì trục X hiện ngày thay vì giờ:phút

    return {
      width: Math.max(width, 1),
      height,
      padding: [8, 8, 0, 8],
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: token.colorTextTertiary,
          grid: { stroke: token.colorBorderSecondary, width: 1 },
          ticks: { show: false },
          font: `11px ${token.fontFamily}`,
          values: (_u, vals) =>
            vals.map((v) => {
              const d = new Date(v * 1000)
              return showDate
                ? d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
                : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
            }),
        },
        {
          stroke: token.colorTextTertiary,
          grid: { stroke: token.colorBorderSecondary, width: 1 },
          ticks: { show: false },
          font: `11px ${token.fontFamily}`,
          values: (_u, vals) => vals.map((v) => (series[0]?.format ? series[0].format(v) : String(v))),
        },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          fill: `${s.color}22`,
          width: 1.5,
          points: { show: false },
        })),
      ],
    }
  }, [width, height, points, series, token])

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {points.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ height, paddingTop: height / 3 }} />
      ) : (
        width > 0 && <UplotReact options={options} data={data} />
      )}
    </div>
  )
}

/** Định dạng byte sang đơn vị đọc được, dùng cho trục Y của biểu đồ RAM/đĩa. */
export function formatBytes(value: number): string {
  if (!value) return '0'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = value
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

/** Định dạng phần trăm, dùng cho trục Y của biểu đồ CPU. */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
