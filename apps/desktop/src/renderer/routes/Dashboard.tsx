import { Button, Card, Empty, Flex, Progress, Segmented, Space, Table, Tag, Typography } from 'antd'
import { ApiOutlined, ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConnections } from '../stores/connections'
import { useClusterResources } from '../hooks/useClusterResources'
import { useSelection } from '../stores/selection'
import { useTasks, recentTasks } from '../stores/tasks'
import { isGuest, type ClusterResource } from '../features/resources/types'
import { RrdChart, formatBytes, formatPercent } from '../components/RrdChart'
import { LedDot, TechDonut } from '../components/TechUi'
import { pveQueryKey, pveRequest } from '../lib/pve'
import { PVE_COLORS } from '../theme/tokens'

function fmtUptime(seconds: number | undefined): string {
  if (!seconds) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function pct(used: number, max: number): number {
  if (!max) return 0
  return Math.max(0, Math.min(100, (used / max) * 100))
}

interface ClusterLogRow {
  uid: number
  time?: number
  pri?: number
  node?: string
  msg?: string
  tag?: string
}

export function Dashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { activeId, phases } = useConnections()
  const select = useSelection((s) => s.select)
  const byUpid = useTasks((s) => s.byUpid)
  const runningTasks = useMemo(() => recentTasks(byUpid, 50).filter((x) => x.phase !== 'done').length, [byUpid])

  const [timeframe, setTimeframe] = useState<'hour' | 'day' | 'week'>('hour')

  const connected = activeId !== null && phases[activeId] === 'authenticated'
  const { resources, at } = useClusterResources(connected ? activeId : null)
  const isLoading = connected && at === null

  const rows = resources as ClusterResource[]
  const nodes = useMemo(() => rows.filter((r) => r.type === 'node'), [rows])
  const guests = useMemo(() => rows.filter(isGuest), [rows])
  const storages = useMemo(() => rows.filter((r) => r.type === 'storage'), [rows])
  const vms = guests.filter((r) => r.type === 'qemu')
  const cts = guests.filter((r) => r.type === 'lxc')
  const vmsRunning = vms.filter((r) => r.status === 'running').length
  const ctsRunning = cts.filter((r) => r.status === 'running').length
  const nodesOnline = nodes.filter((n) => n.status === 'online').length
  const storageActive = storages.filter((s) => s.status === 'available' || !s.status).length

  const cpuUsed = nodes.reduce((a, n) => a + (n.cpu ?? 0) * (n.maxcpu ?? 1), 0)
  const cpuTotal = nodes.reduce((a, n) => a + (n.maxcpu ?? 0), 0)
  const memUsed = nodes.reduce((a, n) => a + (n.mem ?? 0), 0)
  const memTotal = nodes.reduce((a, n) => a + (n.maxmem ?? 0), 0)
  const diskUsed = nodes.reduce((a, n) => a + (n.disk ?? 0), 0)
  const diskTotal = nodes.reduce((a, n) => a + (n.maxdisk ?? 0), 0)
  const cpuPct = cpuTotal ? (cpuUsed / cpuTotal) * 100 : 0
  const memPct = pct(memUsed, memTotal)
  const diskPct = pct(diskUsed, diskTotal)
  const maxUptime = Math.max(0, ...nodes.map((n) => n.uptime ?? 0))

  const topNodes = useMemo(
    () =>
      [...nodes]
        .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
        .slice(0, 5)
        .map((n) => ({ id: n.id, name: n.node ?? n.id, cpu: Math.round((n.cpu ?? 0) * 100), resource: n })),
    [nodes],
  )
  const topGuests = useMemo(
    () =>
      [...guests]
        .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
        .slice(0, 5)
        .map((g) => ({
          id: g.id,
          name: `${g.vmid} ${g.name ?? ''}`.trim(),
          cpu: Math.round((g.cpu ?? 0) * 100),
          resource: g,
        })),
    [guests],
  )

  const rrdNode = nodes.find((n) => n.status === 'online')?.node ?? nodes[0]?.node
  const rrdQuery = useQuery({
    queryKey:
      connected && rrdNode
        ? pveQueryKey(activeId!, 'GET', '/nodes/{node}/rrddata', { node: rrdNode, timeframe })
        : ['dash-rrd', 'idle'],
    queryFn: () =>
      pveRequest<Record<string, number>[]>(activeId!, 'GET', '/nodes/{node}/rrddata', {
        node: rrdNode!,
        timeframe,
      }),
    enabled: connected && Boolean(rrdNode),
    refetchInterval: 30_000,
  })
  const rrdPoints = rrdQuery.data ?? []

  const logQuery = useQuery({
    queryKey: connected ? pveQueryKey(activeId!, 'GET', '/cluster/log', { max: 20 }) : ['dash-log', 'idle'],
    queryFn: () => pveRequest<ClusterLogRow[]>(activeId!, 'GET', '/cluster/log', { max: 20 }),
    enabled: connected,
    refetchInterval: 15_000,
  })
  const alerts = (logQuery.data ?? []).filter((row) => (row.pri ?? 99) <= 5).slice(0, 6)

  const timeframeLabel =
    timeframe === 'hour' ? t('dashboard.timeframeHour') : timeframe === 'day' ? t('dashboard.timeframeDay') : t('dashboard.timeframeWeek')

  if (!connected) {
    return (
      <Flex vertical gap={16}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('dashboard.title')}
        </Typography.Title>
        <Card className="tech-glass-card">
          <Empty
            description={
              <Flex vertical gap={8} align="center">
                <Typography.Text strong>{t('dashboard.noConnection')}</Typography.Text>
                <Typography.Text type="secondary" style={{ maxWidth: 520 }}>
                  {t('dashboard.noConnectionHint')}
                </Typography.Text>
              </Flex>
            }
          >
            <Button type="primary" icon={<ApiOutlined />} onClick={() => void navigate({ to: '/connections' })}>
              {t('nav.connections')}
            </Button>
          </Empty>
        </Card>
      </Flex>
    )
  }

  const summaryCards = [
    { label: t('dashboard.nodesOnline'), value: `${nodesOnline}/${nodes.length}`, hint: 'Online' },
    { label: t('dashboard.vms'), value: String(vms.length), hint: `Running ${vmsRunning}/${vms.length}` },
    { label: t('dashboard.cts'), value: String(cts.length), hint: `Running ${ctsRunning}/${cts.length}` },
    { label: t('dashboard.storageActive'), value: String(storageActive), hint: 'Active' },
    { label: t('dashboard.uptime'), value: fmtUptime(maxUptime), hint: 'Cluster uptime' },
  ]

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('dashboard.title')}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            pve-cluster ({nodes.length} nodes) · {timeframeLabel}
          </Typography.Text>
        </div>
        <Space>
          <Segmented
            size="small"
            value={timeframe}
            onChange={(v) => setTimeframe(v as 'hour' | 'day' | 'week')}
            options={[
              { label: '1h', value: 'hour' },
              { label: '1d', value: 'day' },
              { label: '1w', value: 'week' },
            ]}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              void rrdQuery.refetch()
              void logQuery.refetch()
            }}
          />
        </Space>
      </Flex>

      <Flex gap={12} wrap>
        {summaryCards.map((c) => (
          <Card key={c.label} className="tech-glass-card" size="small" loading={isLoading} style={{ flex: 1, minWidth: 130 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {c.label}
            </Typography.Text>
            <div className="tech-mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>
              {c.value}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {c.hint}
            </Typography.Text>
          </Card>
        ))}
      </Flex>

      <Flex gap={12} wrap>
        <GaugeCard
          title={t('dashboard.cpuUsage')}
          percent={cpuPct}
          color={PVE_COLORS.info}
          detail={t('dashboard.ofCores', {
            used: Math.round(cpuUsed * 10) / 10,
            total: cpuTotal,
          })}
          points={rrdPoints}
          seriesKey="cpu"
          format={formatPercent}
        />
        <GaugeCard
          title={t('dashboard.ramUsage')}
          percent={memPct}
          color={PVE_COLORS.primary}
          detail={t('dashboard.ofBytes', {
            used: formatBytes(memUsed),
            total: formatBytes(memTotal),
          })}
          points={rrdPoints}
          seriesKey="memused"
          format={formatBytes}
          fallbackKey="mem"
        />
        <GaugeCard
          title={t('dashboard.diskUsage')}
          percent={diskPct}
          color={PVE_COLORS.success}
          detail={t('dashboard.ofBytes', {
            used: formatBytes(diskUsed),
            total: formatBytes(diskTotal),
          })}
          points={rrdPoints}
          seriesKey="rootused"
          format={formatBytes}
          fallbackKey="disk"
        />
      </Flex>

      <Flex gap={12} wrap align="stretch">
        <Card className="tech-glass-card" size="small" title={t('dashboard.cpuUsage')} style={{ flex: 2, minWidth: 280 }}>
          <RrdChart
            height={140}
            points={rrdPoints}
            series={[
              { key: 'cpu', label: 'CPU', color: PVE_COLORS.info, format: formatPercent },
              { key: 'memused', label: 'RAM', color: PVE_COLORS.primary, format: formatBytes },
            ]}
          />
        </Card>

        <Card className="tech-glass-card" size="small" title={t('dashboard.topByCpu')} style={{ flex: 1.4, minWidth: 240 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            Nodes
          </Typography.Text>
          {topNodes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => select(n.resource)}
              style={{ width: '100%', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
            >
              <Flex justify="space-between" style={{ marginBottom: 2 }}>
                <span style={{ fontSize: 12 }}>{n.name}</span>
                <span className="tech-mono" style={{ fontSize: 11 }}>
                  {n.cpu}%
                </span>
              </Flex>
              <Progress percent={n.cpu} showInfo={false} size="small" strokeColor={PVE_COLORS.info} />
            </button>
          ))}
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
            Guests
          </Typography.Text>
          {topGuests.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => select(g.resource)}
              style={{ width: '100%', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
            >
              <Flex justify="space-between" style={{ marginBottom: 2 }}>
                <span style={{ fontSize: 12 }}>{g.name}</span>
                <span className="tech-mono" style={{ fontSize: 11 }}>
                  {g.cpu}%
                </span>
              </Flex>
              <Progress percent={g.cpu} showInfo={false} size="small" strokeColor={PVE_COLORS.primary} />
            </button>
          ))}
        </Card>

        <Card className="tech-glass-card" size="small" title={t('dashboard.quickMetrics')} style={{ flex: 1, minWidth: 180 }}>
          <Flex vertical gap={10}>
            <Flex justify="space-between">
              <Typography.Text type="secondary">Cores</Typography.Text>
              <span className="tech-mono">{cpuTotal}</span>
            </Flex>
            <Flex justify="space-between">
              <Typography.Text type="secondary">RAM</Typography.Text>
              <span className="tech-mono">{formatBytes(memTotal)}</span>
            </Flex>
            <Flex justify="space-between">
              <Typography.Text type="secondary">Storage</Typography.Text>
              <span className="tech-mono">{formatBytes(diskTotal)}</span>
            </Flex>
            <Flex justify="space-between">
              <Typography.Text type="secondary">{t('dashboard.runningTasks')}</Typography.Text>
              <Tag className="tech-tag-running">{runningTasks}</Tag>
            </Flex>
            <Flex justify="space-between">
              <Typography.Text type="secondary">{t('dashboard.nodesOnline')}</Typography.Text>
              <Space size={4}>
                <LedDot kind={nodesOnline === nodes.length && nodes.length > 0 ? 'online' : 'warn'} />
                <span className="tech-mono">
                  {nodesOnline}/{nodes.length}
                </span>
              </Space>
            </Flex>
            <Flex justify="space-between">
              <Typography.Text type="secondary">Guests</Typography.Text>
              <span className="tech-mono">
                {vmsRunning + ctsRunning}/{guests.length}
              </span>
            </Flex>
          </Flex>
        </Card>
      </Flex>

      <Card
        className="tech-glass-card neon-border"
        size="small"
        title={
          <Space>
            <LedDot kind={alerts.length ? 'warn' : 'online'} />
            {t('dashboard.recentAlerts')}
            {alerts.length > 0 ? <Tag className="tech-tag-fail">{alerts.length}</Tag> : null}
          </Space>
        }
        extra={
          <Button type="link" size="small" icon={<ArrowRightOutlined />} onClick={() => void navigate({ to: '/cluster-log' })}>
            {t('dashboard.viewAllAlerts')}
          </Button>
        }
      >
        {alerts.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="—" />
        ) : (
          <Flex vertical gap={8}>
            {alerts.map((a, idx) => (
              <Flex
                key={`${a.uid}-${a.time ?? idx}-${idx}`}
                gap={8}
                align="center"
                className="neon-border"
                style={{ padding: '6px 10px', borderRadius: 8 }}
              >
                <LedDot kind={(a.pri ?? 99) <= 3 ? 'error' : 'warn'} />
                <Typography.Text className="tech-mono" type="secondary" style={{ fontSize: 11, width: 72 }}>
                  {a.time ? new Date(a.time * 1000).toLocaleTimeString() : '—'}
                </Typography.Text>
                <Tag color={(a.pri ?? 99) <= 3 ? 'error' : 'warning'}>{a.node ?? a.tag ?? '—'}</Tag>
                <Typography.Text ellipsis style={{ flex: 1, fontSize: 12 }}>
                  {a.msg}
                </Typography.Text>
              </Flex>
            ))}
          </Flex>
        )}
      </Card>

      <Card className="tech-glass-card" title={t('dashboard.guestsTitle')} size="small">
        <Table<ClusterResource>
          size="small"
          loading={isLoading}
          rowKey="id"
          pagination={guests.length > 20 ? { pageSize: 20, size: 'small' } : false}
          dataSource={guests}
          onRow={(r) => ({ onClick: () => select(r), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'VMID', dataIndex: 'vmid', width: 80, sorter: (a, b) => (a.vmid ?? 0) - (b.vmid ?? 0) },
            {
              title: t('dashboard.colName'),
              dataIndex: 'name',
              sorter: (a, b) => (a.name ?? '').localeCompare(b.name ?? ''),
            },
            {
              title: t('dashboard.colType'),
              dataIndex: 'type',
              width: 90,
              render: (v: string) => <Tag>{v === 'qemu' ? 'VM' : 'CT'}</Tag>,
            },
            { title: t('dashboard.colNode'), dataIndex: 'node', width: 100 },
            {
              title: t('dashboard.colStatus'),
              dataIndex: 'status',
              width: 120,
              render: (s: string) => (
                <Space size={6}>
                  <LedDot kind={s === 'running' ? 'running' : 'stopped'} />
                  <span className="tech-mono" style={{ fontSize: 11 }}>
                    {s === 'running' ? t('status.running') : t('status.stopped')}
                  </span>
                </Space>
              ),
            },
            {
              title: 'RAM',
              dataIndex: 'mem',
              width: 140,
              render: (mem: number, r) => (
                <span className="tech-mono" style={{ fontSize: 11 }}>
                  {formatBytes(mem)} / {formatBytes(r.maxmem ?? 0)}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </Flex>
  )
}

function GaugeCard({
  title,
  percent,
  color,
  detail,
  points,
  seriesKey,
  format,
  fallbackKey,
}: {
  title: string
  percent: number
  color: string
  detail: string
  points: Record<string, number>[]
  seriesKey: string
  format: (v: number) => string
  fallbackKey?: string
}): React.JSX.Element {
  const hasSeries = points.some((p) => typeof p[seriesKey] === 'number')
  const key = hasSeries ? seriesKey : (fallbackKey ?? seriesKey)
  return (
    <Card className="tech-glass-card" size="small" style={{ flex: 1, minWidth: 240 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {title}
      </Typography.Text>
      <Flex gap={12} align="center" style={{ marginTop: 8 }}>
        <TechDonut percent={percent} color={color} size={92} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tech-mono" style={{ fontSize: 12, marginBottom: 4 }}>
            {detail}
          </div>
          <RrdChart height={56} points={points} series={[{ key, label: title, color, format }]} />
        </div>
      </Flex>
    </Card>
  )
}
