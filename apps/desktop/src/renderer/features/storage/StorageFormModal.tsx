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
  share?: string
  username?: string
  password?: string
  domain?: string
  portal?: string
  target?: string
  vgname?: string
  thinpool?: string
  pool?: string
  monhost?: string
  'fs-name'?: string
  datastore?: string
  fingerprint?: string
  namespace?: string
  shared?: boolean
  disable?: boolean
  sparse?: boolean
}

/** Wizard thêm storage cluster — đủ field theo loại phổ biến (GĐ 6). */
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

  const cifsShares = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/scan/cifs', { node: scanNode, server }),
    queryFn: () =>
      pveRequest<{ share: string; description?: string }[]>(connectionId, 'GET', '/nodes/{node}/scan/cifs', {
        node: scanNode,
        server,
      }),
    enabled: open && type === 'cifs' && server.length > 0,
  })

  const lvmVgs = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/scan/lvm', { node: scanNode }),
    queryFn: () =>
      pveRequest<{ vg: string }[]>(connectionId, 'GET', '/nodes/{node}/scan/lvm', { node: scanNode }),
    enabled: open && type === 'lvm',
  })

  const lvmThin = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/scan/lvmthin', { node: scanNode }),
    queryFn: () =>
      pveRequest<{ lv: string; vg: string }[]>(connectionId, 'GET', '/nodes/{node}/scan/lvmthin', {
        node: scanNode,
      }),
    enabled: open && type === 'lvmthin',
  })

  const zfsPools = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/scan/zfs', { node: scanNode }),
    queryFn: () =>
      pveRequest<{ pool: string }[]>(connectionId, 'GET', '/nodes/{node}/scan/zfs', { node: scanNode }),
    enabled: open && type === 'zfspool',
  })

  const iscsiTargets = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/scan/iscsi', {
      node: scanNode,
      portal: server,
    }),
    queryFn: () =>
      pveRequest<{ target: string; portal?: string }[]>(connectionId, 'GET', '/nodes/{node}/scan/iscsi', {
        node: scanNode,
        portal: server,
      }),
    enabled: open && type === 'iscsi' && server.length > 0,
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
    <Modal open={open} title={t('storage.addStorage')} onCancel={onClose} footer={null} destroyOnHidden width={560}>
      <PveForm<StorageValues>
        form={form}
        submitText={t('common.save')}
        initialValues={{ type: 'dir', content: 'images,iso,backup', shared: false }}
        onFinish={async (values) => {
          await pveRequest(connectionId, 'POST', '/storage', {
            ...values,
            shared: values.shared ? 1 : 0,
            disable: values.disable ? 1 : 0,
            sparse: values.sparse ? 1 : 0,
          })
          void queryClient.invalidateQueries({
            queryKey: pveQueryKey(connectionId, 'GET', '/storage', {}),
          })
          message.success(t('storage.storageCreated'))
          onClose()
          form.resetFields()
          setServer('')
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

        {(type === 'nfs' || type === 'cifs' || type === 'pbs') && (
          <Form.Item name="server" label="Server" rules={[{ required: true }]}>
            <Input onChange={(e) => setServer(e.target.value)} placeholder="192.168.1.50" />
          </Form.Item>
        )}

        {type === 'iscsi' && (
          <Form.Item name="portal" label="Portal" rules={[{ required: true }]}>
            <Input
              onChange={(e) => {
                setServer(e.target.value)
                form.setFieldValue('portal', e.target.value)
              }}
              placeholder="192.168.1.70:3260"
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

        {type === 'cifs' && (
          <>
            <Form.Item name="share" label="Share" rules={[{ required: true }]}>
              <Select
                showSearch
                options={(cifsShares.data ?? []).map((s) => ({
                  value: s.share,
                  label: s.description ? `${s.share} — ${s.description}` : s.share,
                }))}
                placeholder={server ? t('storage.scanHint') : t('storage.enterServerFirst')}
              />
            </Form.Item>
            <Form.Item name="username" label={t('connections.username')}>
              <Input />
            </Form.Item>
            <Form.Item name="password" label={t('connections.password')}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="domain" label="Domain">
              <Input />
            </Form.Item>
          </>
        )}

        {type === 'iscsi' && (
          <Form.Item name="target" label="Target" rules={[{ required: true }]}>
            <Select
              showSearch
              options={(iscsiTargets.data ?? []).map((t0) => ({
                value: t0.target,
                label: t0.portal ? `${t0.target} @ ${t0.portal}` : t0.target,
              }))}
              placeholder={server ? t('storage.scanHint') : t('storage.enterServerFirst')}
            />
          </Form.Item>
        )}

        {type === 'lvm' && (
          <Form.Item name="vgname" label="VG" rules={[{ required: true }]}>
            <Select
              options={(lvmVgs.data ?? []).map((v) => ({ value: v.vg, label: v.vg }))}
              placeholder={t('storage.scanHint')}
            />
          </Form.Item>
        )}

        {type === 'lvmthin' && (
          <>
            <Form.Item name="vgname" label="VG" rules={[{ required: true }]}>
              <Select
                options={[...new Set((lvmThin.data ?? []).map((v) => v.vg))].map((vg) => ({
                  value: vg,
                  label: vg,
                }))}
                placeholder={t('storage.scanHint')}
              />
            </Form.Item>
            <Form.Item name="thinpool" label="Thin pool" rules={[{ required: true }]}>
              <Select
                options={(lvmThin.data ?? []).map((v) => ({
                  value: v.lv,
                  label: `${v.vg}/${v.lv}`,
                }))}
                placeholder={t('storage.scanHint')}
              />
            </Form.Item>
          </>
        )}

        {type === 'zfspool' && (
          <>
            <Form.Item name="pool" label="Pool" rules={[{ required: true }]}>
              <Select
                options={(zfsPools.data ?? []).map((p) => ({ value: p.pool, label: p.pool }))}
                placeholder={t('storage.scanHint')}
              />
            </Form.Item>
            <Form.Item name="sparse" label="Sparse" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}

        {(type === 'rbd' || type === 'cephfs') && (
          <>
            <Form.Item name="monhost" label="Mon host" rules={[{ required: true }]}>
              <Input placeholder="192.168.1.11 192.168.1.12" />
            </Form.Item>
            {type === 'rbd' && (
              <Form.Item name="pool" label="Pool" rules={[{ required: true }]}>
                <Input placeholder="rbd" />
              </Form.Item>
            )}
            {type === 'cephfs' && (
              <Form.Item name="fs-name" label="FS name" rules={[{ required: true }]}>
                <Input placeholder="cephfs" />
              </Form.Item>
            )}
            <Form.Item name="username" label={t('connections.username')}>
              <Input placeholder="admin" />
            </Form.Item>
          </>
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
            <Form.Item name="password" label={t('connections.password')}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="fingerprint" label="Fingerprint">
              <Input placeholder="SHA256:…" />
            </Form.Item>
            <Form.Item name="namespace" label="Namespace">
              <Input />
            </Form.Item>
          </>
        )}

        <Form.Item name="shared" label={t('storage.shared')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="disable" label={t('storage.disabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </PveForm>
    </Modal>
  )
}
