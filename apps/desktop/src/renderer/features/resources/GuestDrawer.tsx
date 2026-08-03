import { useState } from 'react'
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Flex,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import {
  CameraOutlined,
  CodeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { TaskButton } from '../../components/TaskButton'
import { RrdChart, formatBytes, formatPercent } from '../../components/RrdChart'
import { LedDot } from '../../components/TechUi'
import { CpuMemoryForm, type CpuMemoryValues } from './hardware/CpuMemoryForm'
import { putGuestConfig } from './hardware/put-config'
import { useConnections } from '../../stores/connections'
import { useSelection } from '../../stores/selection'
import { useClusterResources } from '../../hooks/useClusterResources'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { usePermissions } from '../../hooks/usePermissions'
import { GuestConsoleTab } from '../console/GuestConsoleTab'
import { RulesPanel } from '../firewall/FirewallPage'
import { CloudInitTab } from './CloudInitTab'
import { GuestOps } from './GuestOps'
import { GuestTasksTab } from './GuestTasksTab'
import { HardwareTab } from './HardwareTab'
import { OptionsTab } from './OptionsTab'
import { PermissionsTab } from './PermissionsTab'
import { SnapshotTab } from './SnapshotTab'
import { PVE_COLORS } from '../../theme/tokens'

interface GuestStatus {
  status: string
  cpu?: number
  cpus?: number
  mem?: number
  maxmem?: number
  uptime?: number
}

interface SnapshotListItem {
  name: string
}

/**
 * Guest workspace rộng — action bar, 4 RRD, console, hardware side panel (bám mockup).
 */
export function GuestDrawer(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const guest = useSelection((s) => s.selectedGuest)
  const select = useSelection((s) => s.select)
  const activeId = useConnections((s) => s.activeId)
  const [tab, setTab] = useState('overview')

  const open = guest !== null && activeId !== null
  const type = guest?.type as 'qemu' | 'lxc' | undefined
  const node = guest?.node
  const vmid = guest?.vmid
  const tabsKey = guest?.id ?? 'none'

  const canQuery = open && Boolean(type) && Boolean(node) && vmid !== undefined
  const basePath = type && `/nodes/{node}/${type}/{vmid}`
  const configPath = basePath ? `${basePath}/config` : ''

  const statusQuery = useQuery({
    queryKey: canQuery ? pveQueryKey(activeId!, 'GET', `${basePath}/status/current`, { node, vmid }) : ['guest-status', 'idle'],
    queryFn: () => pveRequest<GuestStatus>(activeId!, 'GET', `${basePath}/status/current`, { node, vmid }),
    enabled: canQuery,
    refetchInterval: 3000,
  })

  const rrdQuery = useQuery({
    queryKey: canQuery ? pveQueryKey(activeId!, 'GET', `${basePath}/rrddata`, { node, vmid, timeframe: 'hour' }) : ['guest-rrd', 'idle'],
    queryFn: () =>
      pveRequest<Record<string, number>[]>(activeId!, 'GET', `${basePath}/rrddata`, {
        node,
        vmid,
        timeframe: 'hour',
      }),
    enabled: canQuery,
    refetchInterval: 15_000,
  })

  const configQuery = useQuery({
    queryKey: canQuery ? pveQueryKey(activeId!, 'GET', `${basePath}/config`, { node, vmid }) : ['guest-config', 'idle'],
    queryFn: () => pveRequest<Record<string, unknown>>(activeId!, 'GET', `${basePath}/config`, { node, vmid }),
    enabled: canQuery,
  })

  const nextIdQuery = useQuery({
    queryKey: activeId ? pveQueryKey(activeId, 'GET', '/cluster/nextid', {}) : ['nextid', 'idle'],
    queryFn: () => pveRequest<string | number>(activeId!, 'GET', '/cluster/nextid', {}),
    enabled: Boolean(activeId) && open,
  })

  const snapsQuery = useQuery({
    queryKey: canQuery ? pveQueryKey(activeId!, 'GET', `${basePath}/snapshot`, { node, vmid }) : ['guest-snaps', 'idle'],
    queryFn: () => pveRequest<SnapshotListItem[]>(activeId!, 'GET', `${basePath}/snapshot`, { node, vmid }),
    enabled: canQuery,
  })

  const { resources } = useClusterResources(activeId)
  const nodeNames = (resources as { type?: string; node?: string }[])
    .filter((r) => r.type === 'node' && r.node)
    .map((r) => r.node as string)
    .sort()

  const { can } = usePermissions(activeId)
  const canPower = can('VM.PowerMgmt', vmid !== undefined ? `/vms/${vmid}` : '/')
  const canAllocate = can('VM.Allocate', vmid !== undefined ? `/vms/${vmid}` : '/')
  const canModifyFw = can('Sys.Modify', '/')
  const canConfig = can('VM.Config.CPU', vmid !== undefined ? `/vms/${vmid}` : '/') || can('VM.Config.Memory', vmid !== undefined ? `/vms/${vmid}` : '/')
  const denyPower = t('access.denied')

  const diskKeys = Object.keys(configQuery.data ?? {}).filter((k) =>
    type === 'lxc' ? k === 'rootfs' || /^mp\d+$/.test(k) : /^(scsi|virtio|ide|sata)\d+$/.test(k),
  )

  const status = statusQuery.data?.status ?? guest?.status
  const running = status === 'running'
  const isTemplate =
    guest?.template === 1 ||
    configQuery.data?.['template'] === 1 ||
    configQuery.data?.['template'] === '1'
  const rrdPoints = rrdQuery.data ?? []
  const snapNames = (snapsQuery.data ?? []).map((s) => s.name).filter((n) => n !== 'current')
  const cfg = configQuery.data ?? {}
  const digest = typeof cfg['digest'] === 'string' ? cfg['digest'] : undefined

  const drawerWidth = typeof window !== 'undefined' ? Math.min(Math.round(window.innerWidth * 0.92), 1280) : 1100

  return (
    <Drawer
      title={
        guest ? (
          <Space>
            <LedDot kind={running ? 'running' : 'stopped'} />
            <Typography.Text strong style={{ color: '#fff' }}>
              {type === 'qemu' ? 'VM' : 'CT'} {vmid} — {guest.name}
            </Typography.Text>
            <Tag className={running ? 'tech-tag-running' : undefined}>{status}</Tag>
            {isTemplate ? <Tag color="gold">{t('guest.templateBadge')}</Tag> : null}
          </Space>
        ) : (
          ''
        )
      }
      open={open}
      onClose={() => {
        setTab('overview')
        select(null)
      }}
      width={drawerWidth}
      destroyOnHidden
      styles={{
        body: { paddingTop: 12, background: PVE_COLORS.bgBase },
        header: {
          background: PVE_COLORS.bgElevated,
          borderBottom: `1px solid ${PVE_COLORS.cyanBorder}`,
        },
      }}
    >
      {guest && activeId && basePath && type && node && vmid !== undefined && (
        <Tabs
          key={tabsKey}
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'overview',
              label: t('guest.tabOverview'),
              children: (
                <Flex gap={16} align="start" wrap>
                  <Flex vertical gap={16} style={{ flex: 1, minWidth: 320 }}>
                    <Card className="tech-glass-card" size="small">
                      <Flex justify="space-between" align="center" wrap gap={8}>
                        <Space>
                          <LedDot kind={running ? 'running' : 'stopped'} />
                          <Typography.Text>
                            {t('common.status')}: {status ? t(`status.${status}` as 'status.running') : '—'}
                          </Typography.Text>
                          {statusQuery.data?.uptime !== undefined && statusQuery.data.uptime > 0 && (
                            <Typography.Text type="secondary" className="tech-mono" style={{ fontSize: 12 }}>
                              {t('guest.uptime')}: {formatUptime(statusQuery.data.uptime)}
                            </Typography.Text>
                          )}
                          <Typography.Text type="secondary">· {node}</Typography.Text>
                        </Space>
                        <Space wrap>
                          <TaskButton
                            connectionId={activeId}
                            method="POST"
                            path={`${basePath}/status/start`}
                            params={{ node, vmid }}
                            label={t('guest.start')}
                            icon={<PlayCircleOutlined />}
                            type="primary"
                            disabled={running || Boolean(isTemplate)}
                            allowed={canPower}
                            denyReason={denyPower}
                          />
                          <TaskButton
                            connectionId={activeId}
                            method="POST"
                            path={`${basePath}/status/shutdown`}
                            params={{ node, vmid }}
                            label={t('guest.shutdown')}
                            icon={<PoweroffOutlined />}
                            disabled={!running}
                            allowed={canPower}
                            denyReason={denyPower}
                          />
                          <Button icon={<CameraOutlined />} onClick={() => setTab('snapshot')}>
                            {t('guest.tabSnapshot')}
                          </Button>
                          <Button type="default" icon={<CodeOutlined />} onClick={() => setTab('console')}>
                            {t('guest.tabConsole')}
                          </Button>
                          <TaskButton
                            connectionId={activeId}
                            method="POST"
                            path={`${basePath}/status/stop`}
                            params={{ node, vmid }}
                            label={t('guest.stop')}
                            icon={<PauseCircleOutlined />}
                            danger
                            confirmMessage={t('guest.stopConfirm')}
                            disabled={!running}
                            allowed={canPower}
                            denyReason={denyPower}
                          />
                          <TaskButton
                            connectionId={activeId}
                            method="POST"
                            path={`${basePath}/status/reboot`}
                            params={{ node, vmid }}
                            label={t('guest.reboot')}
                            icon={<ReloadOutlined />}
                            disabled={!running}
                            allowed={canPower}
                            denyReason={denyPower}
                          />
                        </Space>
                      </Flex>
                    </Card>

                    <Card className="tech-glass-card" size="small" title={t('guest.tabHardware')}>
                      <Descriptions column={2} size="small">
                        <Descriptions.Item label={t('guest.memory')}>
                          {formatBytes(statusQuery.data?.mem ?? guest.mem ?? 0)} /{' '}
                          {formatBytes(statusQuery.data?.maxmem ?? guest.maxmem ?? 0)}
                        </Descriptions.Item>
                        <Descriptions.Item label={t('guest.cpu')}>
                          {String(cfg['cores'] ?? cfg['cpus'] ?? statusQuery.data?.cpus ?? '—')} cores
                        </Descriptions.Item>
                        <Descriptions.Item label="BIOS">{String(cfg['bios'] ?? '—')}</Descriptions.Item>
                        <Descriptions.Item label="Machine">{String(cfg['machine'] ?? '—')}</Descriptions.Item>
                        <Descriptions.Item label="SCSI">{String(cfg['scsihw'] ?? '—')}</Descriptions.Item>
                        <Descriptions.Item label="Net">{String(cfg['net0'] ?? '—')}</Descriptions.Item>
                      </Descriptions>
                    </Card>

                    {rrdQuery.isLoading ? (
                      <Skeleton active paragraph={{ rows: 6 }} />
                    ) : (
                      <Flex gap={12} wrap>
                        <MiniChart title={t('guest.cpu')} points={rrdPoints} seriesKey="cpu" color={PVE_COLORS.success} format={formatPercent} />
                        <MiniChart title={t('guest.memory')} points={rrdPoints} seriesKey="mem" color={PVE_COLORS.info} format={formatBytes} />
                        <MiniChart title="Network" points={rrdPoints} seriesKey="netin" color={PVE_COLORS.primary} format={formatBytes} secondKey="netout" />
                        <MiniChart title="Disk I/O" points={rrdPoints} seriesKey="diskread" color="#a78bfa" format={formatBytes} secondKey="diskwrite" />
                      </Flex>
                    )}

                    <Card className="tech-glass-card" size="small" title={t('guest.tabConsole')}>
                      <div style={{ minHeight: 280, border: `1px solid ${PVE_COLORS.cyanBorder}`, borderRadius: 8, overflow: 'hidden' }}>
                        <GuestConsoleTab connectionId={activeId} node={node} type={type} vmid={vmid} />
                      </div>
                    </Card>

                    <GuestOps
                      connectionId={activeId}
                      node={node}
                      type={type}
                      vmid={vmid}
                      nodes={nodeNames}
                      diskKeys={diskKeys}
                      nextId={nextIdQuery.data !== undefined ? Number(nextIdQuery.data) : undefined}
                      isTemplate={Boolean(isTemplate)}
                      snapshots={snapNames}
                    />

                    <TaskButton
                      connectionId={activeId}
                      method="DELETE"
                      path={basePath}
                      params={{ node, vmid, purge: 1 }}
                      label={t('guest.destroy')}
                      danger
                      confirmMessage={t('guest.destroyConfirm')}
                      disabled={running}
                      allowed={canAllocate}
                      denyReason={denyPower}
                    />
                  </Flex>

                  <Card
                    className="tech-glass-card"
                    size="small"
                    title={`${t('guest.tabHardware')} · quick`}
                    style={{ width: 300, flexShrink: 0, position: 'sticky', top: 0 }}
                  >
                    {configQuery.isLoading ? (
                      <Skeleton active />
                    ) : (
                      <CpuMemoryForm
                        guestType={type}
                        initialValues={{
                          cores: Number(cfg['cores'] ?? 1),
                          sockets: Number(cfg['sockets'] ?? 1),
                          memory: Number(cfg['memory'] ?? 512),
                          swap: cfg['swap'] !== undefined ? Number(cfg['swap']) : undefined,
                        }}
                        submitText={t('common.save')}
                        onFinish={async (values: CpuMemoryValues) => {
                          if (!canConfig) {
                            message.error(denyPower)
                            return
                          }
                          await putGuestConfig(
                            activeId,
                            node,
                            type,
                            vmid,
                            {
                              cores: values.cores,
                              ...(type === 'qemu' ? { sockets: values.sockets } : {}),
                              memory: values.memory,
                              ...(type === 'lxc' ? { swap: values.swap } : {}),
                            },
                            digest,
                          )
                          message.success(t('common.save'))
                          void queryClient.invalidateQueries({
                            queryKey: pveQueryKey(activeId, 'GET', configPath, { node, vmid }),
                          })
                        }}
                      />
                    )}
                  </Card>
                </Flex>
              ),
            },
            {
              key: 'console',
              label: t('guest.tabConsole'),
              children: <GuestConsoleTab connectionId={activeId} node={node} type={type} vmid={vmid} />,
            },
            {
              key: 'hardware',
              label: t('guest.tabHardware'),
              children: <HardwareTab connectionId={activeId} node={node} type={type} vmid={vmid} />,
            },
            ...(type === 'qemu'
              ? [
                  {
                    key: 'cloudinit',
                    label: t('guest.tabCloudInit'),
                    children: <CloudInitTab connectionId={activeId} node={node} vmid={vmid} />,
                  },
                ]
              : []),
            {
              key: 'snapshot',
              label: t('guest.tabSnapshot'),
              children: <SnapshotTab connectionId={activeId} node={node} type={type} vmid={vmid} />,
            },
            {
              key: 'options',
              label: t('guest.tabOptions'),
              children: <OptionsTab connectionId={activeId} node={node} type={type} vmid={vmid} />,
            },
            {
              key: 'permissions',
              label: t('guest.tabPermissions'),
              children: <PermissionsTab connectionId={activeId} vmid={vmid} />,
            },
            {
              key: 'firewall',
              label: t('guest.tabFirewall'),
              children: (
                <RulesPanel
                  connectionId={activeId}
                  path={`/nodes/{node}/${type}/{vmid}/firewall/rules`}
                  params={{ node, vmid }}
                  canModify={canModifyFw}
                />
              ),
            },
            {
              key: 'tasks',
              label: t('guest.tabTasks'),
              children: <GuestTasksTab connectionId={activeId} node={node} vmid={vmid} />,
            },
          ]}
        />
      )}
    </Drawer>
  )
}

function MiniChart({
  title,
  points,
  seriesKey,
  color,
  format,
  secondKey,
}: {
  title: string
  points: Record<string, number>[]
  seriesKey: string
  color: string
  format: (v: number) => string
  secondKey?: string
}): React.JSX.Element {
  const series = [{ key: seriesKey, label: title, color, format }]
  if (secondKey) series.push({ key: secondKey, label: secondKey, color: PVE_COLORS.warning, format })
  return (
    <Card className="tech-glass-card" size="small" style={{ flex: 1, minWidth: 200 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {title}
      </Typography.Text>
      <RrdChart height={90} points={points} series={series} />
    </Card>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
