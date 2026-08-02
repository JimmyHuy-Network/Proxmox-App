import { Form, Input, InputNumber, Modal, Select, Switch } from 'antd'
import { App } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../components/PveForm'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { useTasks } from '../../stores/tasks'
import { isUpid } from '@pve/api'

interface RestoreValues {
  [key: string]: unknown
  vmid: number
  storage?: string
  name?: string
  start?: boolean
  unique?: boolean
}

/**
 * Khôi phục guest từ volume backup (archive=) qua POST qemu/lxc.
 */
export function RestoreWizard({
  open,
  connectionId,
  node,
  archive,
  onClose,
}: {
  open: boolean
  connectionId: string
  node: string
  archive: string | null
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<RestoreValues>()
  const addTask = useTasks((s) => s.addTask)

  const nextId = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/cluster/nextid', {}),
    queryFn: () => pveRequest<string | number>(connectionId, 'GET', '/cluster/nextid', {}),
    enabled: open,
  })

  const storages = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/storage', { node }),
    queryFn: () =>
      pveRequest<{ storage: string; content?: string }[]>(connectionId, 'GET', '/nodes/{node}/storage', {
        node,
      }),
    enabled: open,
  })

  const isLxc = archive?.includes('-lxc-') || archive?.includes('/ct/')

  return (
    <Modal open={open} title={t('storage.restore')} onCancel={onClose} footer={null} destroyOnHidden width={520}>
      <PveForm<RestoreValues>
        form={form}
        submitText={t('storage.restore')}
        initialValues={{
          vmid: Number(nextId.data) || 200,
          storage: 'local-lvm',
          start: false,
          unique: true,
        }}
        onFinish={async (values) => {
          if (!archive) return
          const path = isLxc ? '/nodes/{node}/lxc' : '/nodes/{node}/qemu'
          const result = await pveRequest<string>(connectionId, 'POST', path, {
            node,
            vmid: values.vmid,
            archive,
            storage: values.storage,
            ...(values.name ? (isLxc ? { hostname: values.name } : { name: values.name }) : {}),
            ...(values.start ? { start: 1 } : {}),
            ...(values.unique ? { unique: 1 } : {}),
            restore: 1,
          })
          if (isUpid(result)) addTask(connectionId, result)
          message.success(t('storage.restoreStarted'))
          onClose()
        }}
      >
        <Form.Item label={t('storage.archive')}>
          <Input value={archive ?? ''} disabled />
        </Form.Item>
        <Form.Item name="vmid" label="VMID" rules={[{ required: true }]}>
          <InputNumber min={100} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="name" label={isLxc ? 'Hostname' : 'Name'}>
          <Input />
        </Form.Item>
        <Form.Item name="storage" label="Storage">
          <Select
            options={(storages.data ?? [])
              .filter((s) => (s.content ?? '').includes('images') || (s.content ?? '').includes('rootdir'))
              .map((s) => ({ value: s.storage, label: s.storage }))}
          />
        </Form.Item>
        <Form.Item name="unique" label={t('storage.restoreUnique')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="start" label={t('storage.restoreStart')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </PveForm>
    </Modal>
  )
}
