import { Card, Form, Input, Space, Tag } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { TaskButton } from '../../components/TaskButton'
import { PveForm } from '../../components/PveForm'
import { PveGrid } from '../../components/PveGrid'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface SnapshotRow {
  [key: string]: unknown
  name: string
  description?: string
  snaptime?: number
}

interface CreateSnapshotValues {
  [key: string]: unknown
  snapname: string
  description?: string
}

/**
 * Cây snapshot của một guest: tạo mới, rollback, xóa — dùng lại `TaskButton` từ
 * giai đoạn 3 nên không cần viết lại logic theo dõi UPID.
 *
 * Dòng `current` do mock/Proxmox thật luôn chèn thêm để đánh dấu vị trí hiện tại
 * trong cây snapshot — không có `snaptime` thật và không thể rollback/xóa.
 */
export function SnapshotTab({
  connectionId,
  node,
  type,
  vmid,
}: {
  connectionId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<CreateSnapshotValues>()

  const basePath = `/nodes/{node}/${type}/{vmid}/snapshot`
  const params = { node, vmid }
  const listKey = pveQueryKey(connectionId, 'GET', basePath, params)
  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: listKey })

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title={t('guest.snapshotCreate')}>
        <PveForm<CreateSnapshotValues>
          form={form}
          submitText={t('guest.snapshotCreate')}
          onFinish={async (values) => {
            await pveRequest(connectionId, 'POST', basePath, { node, vmid, ...values })
            form.resetFields()
          }}
        >
          <Form.Item name="snapname" label={t('guest.snapshotName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('guest.snapshotDescription')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </PveForm>
      </Card>

      <PveGrid<SnapshotRow>
        connectionId={connectionId}
        method="GET"
        path={basePath}
        params={params}
        rowKey="name"
        refetchInterval={5000}
        emptyText={t('guest.snapshotEmpty')}
        columns={[
          {
            title: t('guest.snapshotName'),
            dataIndex: 'name',
            render: (name: string) =>
              name === 'current' ? <Tag>{t('guest.snapshotCurrent')}</Tag> : name,
          },
          { title: t('guest.snapshotDescription'), dataIndex: 'description' },
          {
            title: t('guest.snapshotTime'),
            dataIndex: 'snaptime',
            width: 180,
            render: (v: number | undefined) => (v ? new Date(v * 1000).toLocaleString() : '—'),
          },
          {
            title: '',
            key: 'actions',
            width: 220,
            render: (_, row: SnapshotRow) =>
              row.name === 'current' ? null : (
                <Space>
                  <TaskButton
                    connectionId={connectionId}
                    method="POST"
                    path={`${basePath}/{snapname}/rollback`}
                    params={{ node, vmid, snapname: row.name }}
                    label={t('guest.snapshotRollback')}
                    size="small"
                    confirmMessage={t('guest.snapshotRollbackConfirm')}
                    onDone={invalidate}
                  />
                  <TaskButton
                    connectionId={connectionId}
                    method="DELETE"
                    path={`${basePath}/{snapname}`}
                    params={{ node, vmid, snapname: row.name }}
                    label={t('common.delete')}
                    danger
                    size="small"
                    confirmMessage={t('guest.snapshotDeleteConfirm')}
                    onDone={invalidate}
                  />
                </Space>
              ),
          },
        ]}
      />
    </Space>
  )
}
