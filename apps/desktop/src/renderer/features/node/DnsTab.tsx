import { Form, Input, App } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../components/PveForm'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface DnsValues {
  [key: string]: unknown
  search: string
  dns1?: string
  dns2?: string
  dns3?: string
}

export function DnsTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<DnsValues>()

  const query = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/dns', { node }),
    queryFn: () => pveRequest<DnsValues>(connectionId, 'GET', '/nodes/{node}/dns', { node }),
  })

  if (query.isLoading || !query.data) {
    return <div>{t('common.loading')}</div>
  }

  return (
    <PveForm<DnsValues>
      form={form}
      key={`${node}-${query.data.search}-${query.data.dns1 ?? ''}`}
      submitText={t('common.save')}
      initialValues={query.data}
      onFinish={async (values) => {
        await pveRequest(connectionId, 'PUT', '/nodes/{node}/dns', { node, ...values })
        void queryClient.invalidateQueries({
          queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/dns', { node }),
        })
        message.success(t('node.dnsSaved'))
      }}
    >
      <Form.Item name="search" label={t('node.dnsSearch')} rules={[{ required: true }]}>
        <Input placeholder="lab.local" />
      </Form.Item>
      <Form.Item name="dns1" label="DNS 1">
        <Input placeholder="192.168.1.1" />
      </Form.Item>
      <Form.Item name="dns2" label="DNS 2">
        <Input />
      </Form.Item>
      <Form.Item name="dns3" label="DNS 3">
        <Input />
      </Form.Item>
    </PveForm>
  )
}
