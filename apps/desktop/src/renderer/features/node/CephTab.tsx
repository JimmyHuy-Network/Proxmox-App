import { Alert, Descriptions, Space, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { formatBytes } from '../../components/RrdChart'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface CephStatus {
  health?: { status?: string }
  fsid?: string
  osdmap?: { num_osds?: number; num_up_osds?: number; num_in_osds?: number }
  pgmap?: { num_pgs?: number; bytes_used?: number; bytes_total?: number }
  quorum_names?: string[]
}

interface MonRow {
  [key: string]: unknown
  name: string
  host?: string
  rank?: number
  quorum?: number | boolean
  state?: string
}

interface PoolRow {
  [key: string]: unknown
  name?: string
  pool_name?: string
  size?: number
  pg_num?: number
  bytes_used?: number
}

export function CephTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()

  const statusQuery = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/ceph/status', { node }),
    queryFn: () => pveRequest<CephStatus>(connectionId, 'GET', '/nodes/{node}/ceph/status', { node }),
    refetchInterval: 8000,
  })

  const health = statusQuery.data?.health?.status ?? '—'
  const warn = health !== 'HEALTH_OK'

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {warn && health !== '—' && (
        <Alert type="warning" showIcon title={`${t('node.cephHealth')}: ${health}`} />
      )}

      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label={t('node.cephHealth')}>
          <Tag color={health === 'HEALTH_OK' ? 'success' : 'warning'}>{health}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="FSID">{statusQuery.data?.fsid ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="OSDs">
          {statusQuery.data?.osdmap?.num_up_osds ?? '—'}/
          {statusQuery.data?.osdmap?.num_osds ?? '—'} up
        </Descriptions.Item>
        <Descriptions.Item label="PGs">{statusQuery.data?.pgmap?.num_pgs ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('storage.used')} span={2}>
          {formatBytes(statusQuery.data?.pgmap?.bytes_used ?? 0)} /{' '}
          {formatBytes(statusQuery.data?.pgmap?.bytes_total ?? 0)}
        </Descriptions.Item>
        <Descriptions.Item label="Quorum" span={2}>
          {(statusQuery.data?.quorum_names ?? []).join(', ') || '—'}
        </Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5} style={{ margin: 0 }}>
        MONs
      </Typography.Title>
      <PveGrid<MonRow>
        connectionId={connectionId}
        method="GET"
        path="/nodes/{node}/ceph/mon"
        params={{ node }}
        rowKey="name"
        columns={[
          { title: 'Name', dataIndex: 'name', width: 100 },
          { title: 'Host', dataIndex: 'host', width: 100 },
          { title: 'Rank', dataIndex: 'rank', width: 70 },
          {
            title: 'Quorum',
            dataIndex: 'quorum',
            width: 90,
            render: (v) => (v ? <Tag color="success">yes</Tag> : <Tag>no</Tag>),
          },
          { title: t('common.status'), dataIndex: 'state', width: 100 },
        ]}
      />

      <Typography.Title level={5} style={{ margin: 0 }}>
        Pools
      </Typography.Title>
      <PveGrid<PoolRow>
        connectionId={connectionId}
        method="GET"
        path="/nodes/{node}/ceph/pool"
        params={{ node }}
        rowKey={(r) => String(r.pool_name ?? r.name)}
        columns={[
          {
            title: 'Pool',
            key: 'name',
            render: (_, r) => r.pool_name ?? r.name,
          },
          { title: 'Size', dataIndex: 'size', width: 70 },
          { title: 'PG', dataIndex: 'pg_num', width: 80 },
          {
            title: t('storage.used'),
            dataIndex: 'bytes_used',
            render: (v?: number) => (v ? formatBytes(v) : '—'),
          },
        ]}
      />
    </Space>
  )
}
