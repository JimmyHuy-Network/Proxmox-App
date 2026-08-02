import { useState } from 'react'
import { App, Form, Input, Modal, Select, Switch } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../components/PveForm'
import { pveQueryKey, pveRequest } from '../../lib/pve'

const STORAGE_TYPES = [
  'dir',
  'nfs',
  'cifs',
  'lvm',
  'lvmthin',
  'zfspool',
  'rbd',
  'cephfs',
  'iscsi',
  'pbs',
  'btrfs',
] as const

interface StorageValues {
  [key: string]: unknown
  storage: string
  type: string
  content: string
  path?: string
  server?: string
  export?: string
  shared?: boolean
  disable?: boolean
  datastore?: string
  username?: string
}

/** Wizard mỏng thêm storage cluster. */
export function StorageFormModal({
  open,
  connectionId,
  scanNode,
  onClose,
}: {
  open: boolean
  connectionId: string
  scanNode: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<StorageValues>()
  const type = Form.useWatch('type', form) ?? 'dir'
  const [server, setServer] = useState('')

  const nfsExports = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/scan/nfs', { node: scanNode, server }),
    queryFn: () =>
      pveRequest<{ path: string }[]>(connectionId, 'GET', '/nodes/{node}/scan/nfs', {
        node: scanNode,
        server,
      }),
    enabled: open && type === 'nfs' && server.length > 0,
  })

  const pbsStores = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/scan/pbs', {
      node: scanNode,
      server,
      username: 'root@pam!',
      password: 'x',
    }),
    queryFn: () =>
      pveRequest<{ store: string }[]>(connectionId, 'GET', '/nodes/{node}/scan/pbs', {
        node: scanNode,
        server,
        username: 'root@pam!',
        password: 'x',
      }),
    enabled: open && type === 'pbs' && server.length > 0,
  })

  return (
    <Modal open={open} title={t('storage.addStorage')} onCancel={onClose} footer={null} destroyOnHidden width={520}>
      <PveForm<StorageValues>
        form={form}
        submitText={t('common.save')}
        initialValues={{ type: 'dir', content: 'images,iso,backup', shared: false }}
        onFinish={async (values) => {
          await pveRequest(connectionId, 'POST', '/storage', {
            ...values,
            shared: values.shared ? 1 : 0,
            disable: values.disable ? 1 : 0,
          })
          void queryClient.invalidateQueries({
            queryKey: pveQueryKey(connectionId, 'GET', '/storage', {}),
          })
          message.success(t('storage.storageCreated'))
          onClose()
          form.resetFields()
        }}
      >
        <Form.Item name="storage" label="ID" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="type" label={t('storage.type')} rules={[{ required: true }]}>
          <Select options={STORAGE_TYPES.map((v) => ({ value: v, label: v }))} />
        </Form.Item>
        <Form.Item name="content" label={t('storage.contentType')} rules={[{ required: true }]}>
          <Input placeholder="images,iso,backup" />
        </Form.Item>

        {(type === 'dir' || type === 'btrfs') && (
          <Form.Item name="path" label="Path" rules={[{ required: true }]}>
            <Input placeholder="/mnt/data" />
          </Form.Item>
        )}

        {(type === 'nfs' || type === 'cifs' || type === 'pbs' || type === 'iscsi') && (
          <Form.Item name="server" label="Server" rules={[{ required: true }]}>
            <Input
              onChange={(e) => setServer(e.target.value)}
              placeholder="192.168.1.50"
            />
          </Form.Item>
        )}

        {type === 'nfs' && (
          <Form.Item name="export" label="Export" rules={[{ required: true }]}>
            <Select
              showSearch
              options={(nfsExports.data ?? []).map((e) => ({ value: e.path, label: e.path }))}
              placeholder={server ? t('storage.scanHint') : t('storage.enterServerFirst')}
            />
          </Form.Item>
        )}

        {type === 'pbs' && (
          <>
            <Form.Item name="datastore" label="Datastore" rules={[{ required: true }]}>
              <Select
                options={(pbsStores.data ?? []).map((s) => ({ value: s.store, label: s.store }))}
                placeholder={server ? t('storage.scanHint') : t('storage.enterServerFirst')}
              />
            </Form.Item>
            <Form.Item name="username" label={t('connections.username')}>
              <Input placeholder="root@pam!" />
            </Form.Item>
          </>
        )}

        <Form.Item name="shared" label={t('storage.shared')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </PveForm>
    </Modal>
  )
}
