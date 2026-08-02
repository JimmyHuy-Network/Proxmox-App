import { Form, Input, App } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../components/PveForm'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface HostsPayload {
  data: string
  digest?: string
}

export function HostsTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<{ data: string }>()

  const query = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/hosts', { node }),
    queryFn: () => pveRequest<HostsPayload>(connectionId, 'GET', '/nodes/{node}/hosts', { node }),
  })

  if (query.isLoading || !query.data) {
    return <div>{t('common.loading')}</div>
  }

  return (
    <PveForm
      form={form}
      key={`${node}-${query.data.digest ?? query.data.data.length}`}
      submitText={t('common.save')}
      initialValues={{ data: query.data.data }}
      onFinish={async (values) => {
        await pveRequest(connectionId, 'POST', '/nodes/{node}/hosts', {
          node,
          data: values.data,
          ...(query.data.digest ? { digest: query.data.digest } : {}),
        })
        void queryClient.invalidateQueries({
          queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/hosts', { node }),
        })
        message.success(t('node.hostsSaved'))
      }}
    >
      <Form.Item name="data" label="/etc/hosts" rules={[{ required: true }]}>
        <Input.TextArea rows={14} style={{ fontFamily: 'ui-monospace, monospace' }} />
      </Form.Item>
    </PveForm>
  )
}
