import { Badge, Descriptions, Drawer, Flex, Skeleton, Space, Tabs, Tag, Typography } from 'antd'
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { TaskButton } from '../../components/TaskButton'
import { RrdChart, formatBytes, formatPercent } from '../../components/RrdChart'
import { useConnections } from '../../stores/connections'
import { useSelection } from '../../stores/selection'
import { useClusterResources } from '../../hooks/useClusterResources'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { CloudInitTab } from './CloudInitTab'
import { GuestOps } from './GuestOps'
import { GuestTasksTab } from './GuestTasksTab'
import { HardwareTab } from './HardwareTab'
import { OptionsTab } from './OptionsTab'
import { PermissionsTab } from './PermissionsTab'
import { SnapshotTab } from './SnapshotTab'

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
 * Xem nhanh một guest: trạng thái trực tiếp, biểu đồ CPU/RAM, và nút vòng đời.
 */
export function GuestDrawer(): React.JSX.Element {
  const { t } = useTranslation()
  const guest = useSelection((s) => s.selectedGuest)
  const select = useSelection((s) => s.select)
  const activeId = useConnections((s) => s.activeId)

  const open = guest !== null && activeId !== null
  const type = guest?.type as 'qemu' | 'lxc' | undefined
  const node = guest?.node
  const vmid = guest?.vmid

  const canQuery = open && Boolean(type) && Boolean(node) && vmid !== undefined
  const basePath = type && `/nodes/{node}/${type}/{vmid}`

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

  return (
    <Drawer
      title={
        guest ? (
          <Space>
            <Badge status={running ? 'success' : 'default'} />
            {guest.name}
            <Tag>{type === 'qemu' ? 'VM' : 'CT'}</Tag>
            {isTemplate ? <Tag color="gold">{t('guest.templateBadge')}</Tag> : null}
            <Typography.Text type="secondary">#{vmid}</Typography.Text>
          </Space>
        ) : (
          ''
        )
      }
      open={open}
      onClose={() => select(null)}
      width={720}
      destroyOnHidden
    >
      {guest && activeId && basePath && type && node && vmid !== undefined && (
        <Tabs
          items={[
            {
              key: 'overview',
              label: t('guest.tabOverview'),
              children: (
                <Flex vertical gap={20}>
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label={t('guest.node')}>{node}</Descriptions.Item>
                    <Descriptions.Item label={t('common.status')}>
                      {status ? t(`status.${status}` as 'status.running') : '—'}
                    </Descriptions.Item>
                    {statusQuery.data?.uptime !== undefined && statusQuery.data.uptime > 0 && (
                      <Descriptions.Item label={t('guest.uptime')}>
                        {formatUptime(statusQuery.data.uptime)}
                      </Descriptions.Item>
                    )}
                  </Descriptions>

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
                    />
                    <TaskButton
                      connectionId={activeId}
                      method="POST"
                      path={`${basePath}/status/shutdown`}
                      params={{ node, vmid }}
                      label={t('guest.shutdown')}
                      icon={<PoweroffOutlined />}
                      disabled={!running}
                    />
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
                    />
                    <TaskButton
                      connectionId={activeId}
                      method="POST"
                      path={`${basePath}/status/reboot`}
                      params={{ node, vmid }}
                      label={t('guest.reboot')}
                      icon={<ReloadOutlined />}
                      disabled={!running}
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
                    />
                  </Space>

                  <GuestOps
                    connectionId={activeId}
                    node={node}
                    type={type}
                    vmid={vmid}
                    nodes={nodeNames}
                    diskKeys={diskKeys}
                    nextId={
                      nextIdQuery.data !== undefined ? Number(nextIdQuery.data) : undefined
                    }
                    isTemplate={Boolean(isTemplate)}
                    snapshots={snapNames}
                  />

                  {rrdQuery.isLoading ? (
                    <Skeleton active paragraph={{ rows: 4 }} />
                  ) : (
                    <Flex vertical gap={16}>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('guest.cpu')}
                        </Typography.Text>
                        <RrdChart
                          points={rrdPoints}
                          series={[{ key: 'cpu', label: 'CPU', color: '#e57000', format: formatPercent }]}
                        />
                      </div>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('guest.memory')}
                        </Typography.Text>
                        <RrdChart
                          points={rrdPoints}
                          series={[{ key: 'mem', label: 'RAM', color: '#1668dc', format: formatBytes }]}
                        />
                      </div>
                    </Flex>
                  )}
                </Flex>
              ),
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

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} ngày ${hours} giờ`
  if (hours > 0) return `${hours} giờ ${minutes} phút`
  return `${minutes} phút`
}
