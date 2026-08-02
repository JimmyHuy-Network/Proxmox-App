import { useState } from 'react'
import { InputNumber, Space, Table, Tabs, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface SyslogRow {
  [key: string]: unknown
  n: number
  t: string
}

export function LogsTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [limit, setLimit] = useState(50)

  return (
    <Tabs
      size="small"
      items={[
        {
          key: 'syslog',
          label: 'Syslog',
          children: (
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Space>
                <Typography.Text type="secondary">{t('node.logLimit')}</Typography.Text>
                <InputNumber min={10} max={200} value={limit} onChange={(v) => setLimit(v ?? 50)} />
              </Space>
              <PveGrid<SyslogRow>
                connectionId={connectionId}
                method="GET"
                path="/nodes/{node}/syslog"
                params={{ node, start: 0, limit }}
                rowKey="n"
                refetchInterval={8000}
                emptyText={t('node.logsEmpty')}
                columns={[
                  { title: '#', dataIndex: 'n', width: 70 },
                  { title: t('clusterLog.msg'), dataIndex: 't', ellipsis: true },
                ]}
              />
            </Space>
          ),
        },
        {
          key: 'journal',
          label: 'Journal',
          children: <JournalTable connectionId={connectionId} node={node} lastentries={limit} />,
        },
      ]}
    />
  )
}

function JournalTable({
  connectionId,
  node,
  lastentries,
}: {
  connectionId: string
  node: string
  lastentries: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/journal', { node, lastentries }),
    queryFn: () =>
      pveRequest<string[]>(connectionId, 'GET', '/nodes/{node}/journal', { node, lastentries }),
    refetchInterval: 8000,
  })

  const rows = (q.data ?? []).map((line, i) => {
    try {
      const obj = JSON.parse(line) as { MESSAGE?: string; SYSLOG_IDENTIFIER?: string }
      return {
        id: String(i),
        line: `${obj.SYSLOG_IDENTIFIER ?? 'journal'}: ${obj.MESSAGE ?? line}`,
      }
    } catch {
      return { id: String(i), line }
    }
  })

  return (
    <Table
      size="small"
      rowKey="id"
      loading={q.isLoading}
      dataSource={rows}
      pagination={false}
      locale={{ emptyText: t('node.logsEmpty') }}
      columns={[{ title: t('clusterLog.msg'), dataIndex: 'line', ellipsis: true }]}
    />
  )
}
