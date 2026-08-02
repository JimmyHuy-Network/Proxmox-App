import { useState } from 'react'
import { App, Button, Form, Input, Modal, Select, Space, Switch, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { TaskButton } from '../../components/TaskButton'
import { PveForm } from '../../components/PveForm'
import { PveGrid } from '../../components/PveGrid'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface BackupJobRow {
  [key: string]: unknown
  id: string
  enabled?: number | boolean
  schedule?: string
  storage?: string
  mode?: string
  compress?: string
  comment?: string
  vmid?: string
  all?: number | boolean
  node?: string
}

interface JobValues {
  [key: string]: unknown
  id: string
  schedule: string
  storage: string
  mode: string
  compress: string
  comment?: string
  vmid?: string
  enabled?: boolean
  all?: boolean
  node?: string
}

/** Lịch vzdump cụm — `/cluster/backup`. */
export function BackupJobsTab({
  connectionId,
  defaultNode,
}: {
  connectionId: string
  defaultNode: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm<JobValues>()

  const listKey = pveQueryKey(connectionId, 'GET', '/cluster/backup', {})
  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: listKey })

  const storages = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/storage', { node: defaultNode }),
    queryFn: () =>
      pveRequest<{ storage: string; content?: string }[]>(connectionId, 'GET', '/nodes/{node}/storage', {
        node: defaultNode,
      }),
  })

  const backupStorages = (storages.data ?? []).filter((s) => (s.content ?? '').includes('backup'))

  const notBackedUp = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/cluster/backup-info/not-backed-up', {}),
    queryFn: () =>
      pveRequest<{ vmid: number; name?: string; type?: string }[]>(
        connectionId,
        'GET',
        '/cluster/backup-info/not-backed-up',
        {},
      ),
    refetchInterval: 30_000,
  })

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {notBackedUp.data && notBackedUp.data.length > 0 && (
        <Space wrap>
          <span>{t('storage.notBackedUp')}:</span>
          {notBackedUp.data.map((g) => (
            <Tag key={g.vmid}>
              {g.vmid} {g.name}
            </Tag>
          ))}
        </Space>
      )}

      <PveGrid<BackupJobRow>
        connectionId={connectionId}
        method="GET"
        path="/cluster/backup"
        rowKey="id"
        emptyText={t('storage.backupJobsEmpty')}
        toolbar={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            {t('storage.backupJobAdd')}
          </Button>
        }
        columns={[
          { title: 'ID', dataIndex: 'id', width: 160 },
          {
            title: t('common.status'),
            dataIndex: 'enabled',
            width: 100,
            render: (v) =>
              v === 0 || v === false ? (
                <Tag>{t('storage.disabled')}</Tag>
              ) : (
                <Tag color="green">{t('storage.enabled')}</Tag>
              ),
          },
          { title: t('storage.schedule'), dataIndex: 'schedule', width: 120 },
          { title: 'Storage', dataIndex: 'storage', width: 120 },
          { title: t('storage.mode'), dataIndex: 'mode', width: 100 },
          { title: t('storage.compress'), dataIndex: 'compress', width: 90 },
          { title: 'VMID', dataIndex: 'vmid', width: 120 },
          { title: t('storage.comment'), dataIndex: 'comment', ellipsis: true },
          {
            title: '',
            key: 'actions',
            width: 100,
            render: (_, row) => (
              <TaskButton
                connectionId={connectionId}
                method="DELETE"
                path="/cluster/backup/{id}"
                params={{ id: row.id }}
                label={t('common.delete')}
                danger
                size="small"
                confirmMessage={t('storage.backupJobDeleteConfirm')}
                onDone={invalidate}
              />
            ),
          },
        ]}
      />

      <Modal
        open={open}
        title={t('storage.backupJobAdd')}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <PveForm<JobValues>
          form={form}
          submitText={t('common.save')}
          initialValues={{
            schedule: '02:00',
            storage: backupStorages[0]?.storage ?? 'local',
            mode: 'snapshot',
            compress: 'zstd',
            enabled: true,
            node: defaultNode,
          }}
          onFinish={async (values) => {
            await pveRequest(connectionId, 'POST', '/cluster/backup', {
              ...values,
              enabled: values.enabled ? 1 : 0,
              all: values.all ? 1 : 0,
            })
            setOpen(false)
            form.resetFields()
            invalidate()
            message.success(t('storage.backupJobSaved'))
          }}
        >
          <Form.Item name="id" label="ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="schedule" label={t('storage.schedule')} rules={[{ required: true }]}>
            <Input placeholder="sun 02:00" />
          </Form.Item>
          <Form.Item name="storage" label="Storage" rules={[{ required: true }]}>
            <Select options={backupStorages.map((s) => ({ value: s.storage, label: s.storage }))} />
          </Form.Item>
          <Form.Item name="mode" label={t('storage.mode')}>
            <Select
              options={[
                { value: 'snapshot', label: 'snapshot' },
                { value: 'suspend', label: 'suspend' },
                { value: 'stop', label: 'stop' },
              ]}
            />
          </Form.Item>
          <Form.Item name="compress" label={t('storage.compress')}>
            <Select
              options={[
                { value: 'zstd', label: 'zstd' },
                { value: 'gzip', label: 'gzip' },
                { value: 'lzo', label: 'lzo' },
                { value: '0', label: 'none' },
              ]}
            />
          </Form.Item>
          <Form.Item name="vmid" label="VMID">
            <Input placeholder="100,101" />
          </Form.Item>
          <Form.Item name="node" label="Node">
            <Input />
          </Form.Item>
          <Form.Item name="comment" label={t('storage.comment')}>
            <Input />
          </Form.Item>
          <Form.Item name="enabled" label={t('storage.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="all" label={t('storage.backupAll')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </PveForm>
      </Modal>
    </Space>
  )
}
