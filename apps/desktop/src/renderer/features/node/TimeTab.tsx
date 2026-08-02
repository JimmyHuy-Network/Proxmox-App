import { Form, Input, Descriptions, App } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../components/PveForm'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface TimePayload {
  timezone: string
  time: number
  localtime: number
}

export function TimeTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<{ timezone: string }>()

  const query = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/time', { node }),
    queryFn: () => pveRequest<TimePayload>(connectionId, 'GET', '/nodes/{node}/time', { node }),
    refetchInterval: 10_000,
  })

  if (query.isLoading || !query.data) {
    return <div>{t('common.loading')}</div>
  }

  return (
    <>
      <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t('node.utcTime')}>
          {new Date(query.data.time * 1000).toISOString()}
        </Descriptions.Item>
        <Descriptions.Item label={t('node.localTime')}>
          {new Date(query.data.localtime * 1000).toLocaleString()}
        </Descriptions.Item>
      </Descriptions>

      <PveForm
        form={form}
        key={`${node}-${query.data.timezone}`}
        submitText={t('common.save')}
        initialValues={{ timezone: query.data.timezone }}
        onFinish={async (values) => {
          await pveRequest(connectionId, 'PUT', '/nodes/{node}/time', {
            node,
            timezone: values.timezone,
          })
          void queryClient.invalidateQueries({
            queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/time', { node }),
          })
          message.success(t('node.timeSaved'))
        }}
      >
        <Form.Item name="timezone" label={t('node.timezone')} rules={[{ required: true }]}>
          <Input placeholder="Asia/Ho_Chi_Minh" />
        </Form.Item>
      </PveForm>
    </>
  )
}
