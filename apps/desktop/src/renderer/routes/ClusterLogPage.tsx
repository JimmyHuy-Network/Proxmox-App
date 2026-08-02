import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../components/PveGrid'
import { useConnections } from '../stores/connections'

interface ClusterLogRow {
  [key: string]: unknown
  uid: number
  time?: number
  pri?: number
  tag?: string
  node?: string
  user?: string
  msg?: string
}

function priColor(pri: number | undefined): string {
  if (pri === undefined) return 'default'
  if (pri <= 3) return 'error'
  if (pri <= 4) return 'warning'
  return 'default'
}

/**
 * Nhật ký cụm — `GET /cluster/log` (GĐ 3).
 */
export function ClusterLogPage(): React.JSX.Element {
  const { t } = useTranslation()
  const activeId = useConnections((s) => s.activeId)
  const phase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && phase === 'authenticated'

  if (!connected || !activeId) {
    return <div>{t('dashboard.noConnection')}</div>
  }

  return (
    <PveGrid<ClusterLogRow>
      connectionId={activeId}
      method="GET"
      path="/cluster/log"
      params={{ max: 100 }}
      rowKey="uid"
      refetchInterval={8000}
      emptyText={t('clusterLog.empty')}
      search={(row, q) =>
        (row.msg?.toLowerCase().includes(q.toLowerCase()) ?? false) ||
        (row.node?.toLowerCase().includes(q.toLowerCase()) ?? false) ||
        (row.tag?.toLowerCase().includes(q.toLowerCase()) ?? false)
      }
      searchPlaceholder={t('clusterLog.search')}
      columns={[
        {
          title: t('clusterLog.time'),
          dataIndex: 'time',
          width: 170,
          render: (v: number | undefined) => (v ? new Date(v * 1000).toLocaleString() : '—'),
        },
        {
          title: t('clusterLog.pri'),
          dataIndex: 'pri',
          width: 70,
          render: (pri: number | undefined) => <Tag color={priColor(pri)}>{pri ?? '—'}</Tag>,
        },
        { title: t('clusterLog.node'), dataIndex: 'node', width: 100 },
        { title: t('clusterLog.tag'), dataIndex: 'tag', width: 120 },
        { title: t('clusterLog.user'), dataIndex: 'user', width: 120 },
        { title: t('clusterLog.msg'), dataIndex: 'msg', ellipsis: true },
      ]}
    />
  )
}
