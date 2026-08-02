import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'

interface TaskRow {
  [key: string]: unknown
  upid: string
  type: string
  status: string
  user?: string
  starttime?: number
  endtime?: number
  exitstatus?: string
}

/**
 * Lịch sử task theo guest — `GET /nodes/{node}/tasks?vmid=`.
 */
export function GuestTasksTab({
  connectionId,
  node,
  vmid,
}: {
  connectionId: string
  node: string
  vmid: number
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <PveGrid<TaskRow>
      connectionId={connectionId}
      method="GET"
      path="/nodes/{node}/tasks"
      params={{ node, vmid, source: 'all', limit: 50 }}
      rowKey="upid"
      refetchInterval={5000}
      emptyText={t('guest.tasksEmpty')}
      columns={[
        {
          title: t('guest.tasksType'),
          dataIndex: 'type',
          width: 140,
        },
        {
          title: t('common.status'),
          dataIndex: 'status',
          width: 110,
          render: (status: string, row) => (
            <Tag color={status === 'running' ? 'processing' : row.exitstatus === 'OK' ? 'success' : 'error'}>
              {row.exitstatus ?? status}
            </Tag>
          ),
        },
        {
          title: t('guest.tasksUser'),
          dataIndex: 'user',
          width: 140,
        },
        {
          title: t('guest.tasksStart'),
          dataIndex: 'starttime',
          render: (v: number | undefined) => (v ? new Date(v * 1000).toLocaleString() : '—'),
        },
        {
          title: 'UPID',
          dataIndex: 'upid',
          ellipsis: true,
        },
      ]}
    />
  )
}
