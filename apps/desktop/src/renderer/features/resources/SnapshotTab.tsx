import { Card, Form, Input, Space, Tag, Typography } from 'antd'
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
  parent?: string
}

interface CreateSnapshotValues {
  [key: string]: unknown
  snapname: string
  description?: string
}

/**
 * Cây snapshot của một guest: tạo mới, rollback, xóa — indent theo `parent`.
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
            <Input data-testid="snapshot-name-input" />
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
        transform={sortSnapshotsForTree}
        columns={[
          {
            title: t('guest.snapshotName'),
            dataIndex: 'name',
            render: (name: string, row: SnapshotRow) => {
              const indent = typeof row['__depth'] === 'number' ? (row['__depth'] as number) : 0
              if (name === 'current') {
                return (
                  <span style={{ paddingLeft: indent * 16 }}>
                    <Tag>{t('guest.snapshotCurrent')}</Tag>
                  </span>
                )
              }
              return <span style={{ paddingLeft: indent * 16 }}>{name}</span>
            },
          },
          {
            title: t('guest.snapshotParent'),
            dataIndex: 'parent',
            width: 140,
            render: (v: string | undefined) => v ?? '—',
          },
          { title: t('guest.snapshotDescription'), dataIndex: 'description' },
          {
            title: t('guest.snapshotTime'),
            dataIndex: 'snaptime',
            width: 160,
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
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('guest.snapshotTreeHint')}
      </Typography.Text>
    </Space>
  )
}

/** Sắp xếp DFS theo parent và gắn `__depth` để indent. */
export function sortSnapshotsForTree(rows: SnapshotRow[]): SnapshotRow[] {
  const snaps = rows.filter((r) => r.name !== 'current')
  const current = rows.find((r) => r.name === 'current')
  const byParent = new Map<string | undefined, SnapshotRow[]>()
  for (const s of snaps) {
    const p = s.parent
    const list = byParent.get(p) ?? []
    list.push(s)
    byParent.set(p, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.snaptime ?? 0) - (b.snaptime ?? 0) || a.name.localeCompare(b.name))
  }

  const out: SnapshotRow[] = []
  const walk = (parent: string | undefined, depth: number): void => {
    for (const child of byParent.get(parent) ?? []) {
      out.push({ ...child, __depth: depth })
      walk(child.name, depth + 1)
    }
  }
  walk(undefined, 0)
  const placed = new Set(out.map((r) => r.name))
  for (const s of snaps) {
    if (!placed.has(s.name)) out.push({ ...s, __depth: 0 })
  }
  if (current) {
    const leaf = out.at(-1)
    out.push({ ...current, __depth: leaf ? Number(leaf['__depth'] ?? 0) : 0, parent: leaf?.name })
  }
  return out
}
