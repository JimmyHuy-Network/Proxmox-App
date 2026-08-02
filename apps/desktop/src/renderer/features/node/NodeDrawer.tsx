import { useState } from 'react'
import { Badge, Descriptions, Drawer, Flex, Skeleton, Space, Tabs, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RrdChart, formatBytes, formatPercent } from '../../components/RrdChart'
import { useConnections } from '../../stores/connections'
import { useSelection } from '../../stores/selection'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { NodeShellButton } from '../console/NodeShellButton'
import { NetworkTab } from './NetworkTab'
import { DnsTab } from './DnsTab'
import { HostsTab } from './HostsTab'
import { TimeTab } from './TimeTab'

interface NodeStatus {
  uptime?: number
  cpu?: number
  memory?: { total?: number; used?: number; free?: number }
  rootfs?: { total?: number; used?: number; avail?: number }
  pveversion?: string
  kversion?: string
  loadavg?: string[]
  cpuinfo?: { cpus?: number; model?: string }
}

/**
 * Drawer chi tiết node (GĐ 7): tổng quan, mạng, DNS, hosts, time.
 */
export function NodeDrawer(): React.JSX.Element {
  const { t } = useTranslation()
  const nodeRes = useSelection((s) => s.selectedNode)
  const select = useSelection((s) => s.select)
  const activeId = useConnections((s) => s.activeId)
  const [tab, setTab] = useState('overview')

  const open = nodeRes !== null && activeId !== null
  const node = nodeRes?.node
  const tabsKey = nodeRes?.id ?? 'none'

  const canQuery = open && Boolean(node)

  const statusQuery = useQuery({
    queryKey: canQuery
      ? pveQueryKey(activeId!, 'GET', '/nodes/{node}/status', { node })
      : ['node-status', 'idle'],
    queryFn: () => pveRequest<NodeStatus>(activeId!, 'GET', '/nodes/{node}/status', { node }),
    enabled: canQuery,
    refetchInterval: 5000,
  })

  const rrdQuery = useQuery({
    queryKey: canQuery
      ? pveQueryKey(activeId!, 'GET', '/nodes/{node}/rrddata', { node, timeframe: 'hour' })
      : ['node-rrd', 'idle'],
    queryFn: () =>
      pveRequest<Record<string, number>[]>(activeId!, 'GET', '/nodes/{node}/rrddata', {
        node,
        timeframe: 'hour',
      }),
    enabled: canQuery,
    refetchInterval: 15_000,
  })

  const online = nodeRes?.status === 'online'

  return (
    <Drawer
      open={open}
      width={720}
      onClose={() => select(null)}
      destroyOnHidden
      title={
        <Flex align="center" gap={8} wrap>
          <Typography.Text strong>{node}</Typography.Text>
          <Badge
            status={online ? 'success' : 'error'}
            text={online ? t('status.running') : t('node.offline')}
          />
          {activeId && node && <NodeShellButton connectionId={activeId} node={node} />}
        </Flex>
      }
    >
      {canQuery && activeId && node ? (
        <Tabs
          key={tabsKey}
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'overview',
              label: t('node.tabOverview'),
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  {statusQuery.isLoading ? (
                    <Skeleton active />
                  ) : (
                    <Descriptions size="small" column={2} bordered>
                      <Descriptions.Item label="CPU">
                        {formatPercent(statusQuery.data?.cpu ?? 0)} (
                        {statusQuery.data?.cpuinfo?.cpus ?? '—'} cores)
                      </Descriptions.Item>
                      <Descriptions.Item label="RAM">
                        {formatBytes(statusQuery.data?.memory?.used ?? 0)} /{' '}
                        {formatBytes(statusQuery.data?.memory?.total ?? 0)}
                      </Descriptions.Item>
                      <Descriptions.Item label="Rootfs">
                        {formatBytes(statusQuery.data?.rootfs?.used ?? 0)} /{' '}
                        {formatBytes(statusQuery.data?.rootfs?.total ?? 0)}
                      </Descriptions.Item>
                      <Descriptions.Item label="Load">
                        {(statusQuery.data?.loadavg ?? []).join(' / ') || '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="PVE" span={2}>
                        {statusQuery.data?.pveversion ?? '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Kernel" span={2}>
                        {statusQuery.data?.kversion ?? '—'}
                      </Descriptions.Item>
                    </Descriptions>
                  )}
                  <RrdChart
                    points={rrdQuery.data ?? []}
                    series={[
                      { key: 'cpu', label: 'CPU', color: '#1677ff' },
                      { key: 'mem', label: 'RAM', color: '#52c41a' },
                    ]}
                  />
                </Space>
              ),
            },
            {
              key: 'network',
              label: t('node.tabNetwork'),
              children: <NetworkTab connectionId={activeId} node={node} />,
            },
            {
              key: 'dns',
              label: t('node.tabDns'),
              children: <DnsTab connectionId={activeId} node={node} />,
            },
            {
              key: 'hosts',
              label: t('node.tabHosts'),
              children: <HostsTab connectionId={activeId} node={node} />,
            },
            {
              key: 'time',
              label: t('node.tabTime'),
              children: <TimeTab connectionId={activeId} node={node} />,
            },
          ]}
        />
      ) : null}
    </Drawer>
  )
}
