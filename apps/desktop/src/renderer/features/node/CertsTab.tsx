import { Space, Tag, Typography } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { TaskButton } from '../../components/TaskButton'
import { pveQueryKey } from '../../lib/pve'

interface CertRow {
  [key: string]: unknown
  filename: string
  fingerprint?: string
  issuer?: string
  subject?: string
  notafter?: number
  notbefore?: number
}

export function CertsTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const invalidate = (): void => {
    void queryClient.invalidateQueries({
      queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/certificates/info', { node }),
    })
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <TaskButton
          connectionId={connectionId}
          method="POST"
          path="/nodes/{node}/certificates/acme/certificate"
          params={{ node }}
          label={t('node.acmeOrder')}
          type="primary"
          onDone={invalidate}
        />
        <TaskButton
          connectionId={connectionId}
          method="PUT"
          path="/nodes/{node}/certificates/acme/certificate"
          params={{ node }}
          label={t('node.acmeRenew')}
          onDone={invalidate}
        />
        <Typography.Text type="secondary">{t('node.certsHint')}</Typography.Text>
      </Space>

      <PveGrid<CertRow>
        connectionId={connectionId}
        method="GET"
        path="/nodes/{node}/certificates/info"
        params={{ node }}
        rowKey="filename"
        emptyText={t('node.certsEmpty')}
        columns={[
          { title: t('node.filename'), dataIndex: 'filename', width: 160 },
          { title: t('node.subject'), dataIndex: 'subject', ellipsis: true },
          { title: t('node.issuer'), dataIndex: 'issuer', ellipsis: true },
          {
            title: t('node.notAfter'),
            dataIndex: 'notafter',
            width: 170,
            render: (v?: number) => (v ? new Date(v * 1000).toLocaleString() : '—'),
          },
          {
            title: 'Fingerprint',
            dataIndex: 'fingerprint',
            ellipsis: true,
            render: (v?: string) => (v ? <Tag>{v.slice(0, 17)}…</Tag> : '—'),
          },
        ]}
      />
    </Space>
  )
}
