import { Space, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { TaskButton } from '../../components/TaskButton'

interface AptRow {
  [key: string]: unknown
  Package: string
  Title?: string
  Version?: string
  OldVersion?: string
  Origin?: string
}

export function AptTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space>
        <TaskButton
          connectionId={connectionId}
          method="POST"
          path="/nodes/{node}/apt/update"
          params={{ node }}
          label={t('node.aptRefresh')}
          type="primary"
        />
        <Typography.Text type="secondary">{t('node.aptHint')}</Typography.Text>
      </Space>

      <Typography.Title level={5} style={{ margin: 0 }}>
        {t('node.aptUpdates')}
      </Typography.Title>
      <PveGrid<AptRow>
        connectionId={connectionId}
        method="GET"
        path="/nodes/{node}/apt/update"
        params={{ node }}
        rowKey="Package"
        emptyText={t('node.aptUpToDate')}
        columns={[
          { title: 'Package', dataIndex: 'Package', width: 160 },
          { title: t('node.title'), dataIndex: 'Title', ellipsis: true },
          {
            title: t('node.version'),
            key: 'ver',
            width: 200,
            render: (_, row) => (
              <Space size={4}>
                <Tag>{row.OldVersion ?? '—'}</Tag>→<Tag color="blue">{row.Version}</Tag>
              </Space>
            ),
          },
        ]}
      />

      <Typography.Title level={5} style={{ margin: 0 }}>
        {t('node.aptVersions')}
      </Typography.Title>
      <PveGrid<AptRow>
        connectionId={connectionId}
        method="GET"
        path="/nodes/{node}/apt/versions"
        params={{ node }}
        rowKey="Package"
        columns={[
          { title: 'Package', dataIndex: 'Package', width: 180 },
          { title: t('node.title'), dataIndex: 'Title', ellipsis: true },
          { title: t('node.version'), dataIndex: 'Version', width: 120 },
        ]}
      />
    </Space>
  )
}
