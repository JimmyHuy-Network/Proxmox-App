import { useState } from 'react'
import { App, Button, Descriptions, Modal, Space, Tabs, Tag, Typography } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { TaskButton } from '../../components/TaskButton'
import { formatBytes } from '../../components/RrdChart'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface DiskRow {
  [key: string]: unknown
  devpath: string
  size?: number
  model?: string
  health?: string
  gpt?: number
  used?: string
}

interface DirRow {
  [key: string]: unknown
  path: string
  device?: string
  type?: string
}

interface ThinRow {
  [key: string]: unknown
  lv: string
  vg?: string
  lv_size?: number
  used?: number
}

interface ZfsRow {
  [key: string]: unknown
  name: string
  size?: number
  free?: number
  health?: string
}

export function DisksTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [smartDisk, setSmartDisk] = useState<string | null>(null)

  const listKey = pveQueryKey(connectionId, 'GET', '/nodes/{node}/disks/list', { node })
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['pve', connectionId] })
  }

  const disksQuery = useQuery({
    queryKey: listKey,
    queryFn: () => pveRequest<DiskRow[]>(connectionId, 'GET', '/nodes/{node}/disks/list', { node }),
  })

  const smartQuery = useQuery({
    queryKey: smartDisk
      ? pveQueryKey(connectionId, 'GET', '/nodes/{node}/disks/smart', { node, disk: smartDisk })
      : ['smart', 'idle'],
    queryFn: () =>
      pveRequest<{
        health?: string
        text?: string
        attributes?: { name: string; value?: number; raw?: string }[]
      }>(connectionId, 'GET', '/nodes/{node}/disks/smart', { node, disk: smartDisk }),
    enabled: Boolean(smartDisk),
  })

  const freeDevs = (disksQuery.data ?? []).filter((d) => !d.used).map((d) => d.devpath)

  return (
    <>
      <Tabs
        size="small"
        items={[
          {
            key: 'list',
            label: t('node.disksList'),
            children: (
              <PveGrid<DiskRow>
                connectionId={connectionId}
                method="GET"
                path="/nodes/{node}/disks/list"
                params={{ node }}
                rowKey="devpath"
                emptyText={t('node.disksEmpty')}
                columns={[
                  { title: t('node.disk'), dataIndex: 'devpath', width: 140 },
                  {
                    title: t('storage.size'),
                    dataIndex: 'size',
                    width: 110,
                    render: (v?: number) => (v ? formatBytes(v) : '—'),
                  },
                  { title: t('node.model'), dataIndex: 'model', ellipsis: true },
                  {
                    title: t('node.health'),
                    dataIndex: 'health',
                    width: 100,
                    render: (h?: string) => (
                      <Tag color={h === 'PASSED' ? 'success' : 'warning'}>{h ?? '—'}</Tag>
                    ),
                  },
                  { title: t('node.used'), dataIndex: 'used', width: 90, render: (v) => v || '—' },
                  {
                    title: '',
                    key: 'actions',
                    width: 240,
                    render: (_, row) => (
                      <Space size={4} wrap>
                        <Button size="small" onClick={() => setSmartDisk(row.devpath)}>
                          SMART
                        </Button>
                        {!row.gpt && (
                          <TaskButton
                            connectionId={connectionId}
                            method="POST"
                            path="/nodes/{node}/disks/initgpt"
                            params={{ node, disk: row.devpath }}
                            label={t('node.initGpt')}
                            size="small"
                            onDone={invalidate}
                          />
                        )}
                        {!row.used && (
                          <TaskButton
                            connectionId={connectionId}
                            method="PUT"
                            path="/nodes/{node}/disks/wipedisk"
                            params={{ node, disk: row.devpath }}
                            label={t('node.wipe')}
                            size="small"
                            danger
                            confirmMessage={t('node.wipeConfirm')}
                            onDone={invalidate}
                          />
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'dir',
            label: 'Directory',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space wrap>
                  {freeDevs.slice(0, 2).map((dev) => (
                    <TaskButton
                      key={dev}
                      connectionId={connectionId}
                      method="POST"
                      path="/nodes/{node}/disks/directory"
                      params={{
                        node,
                        device: dev,
                        name: `dir-${dev.split('/').pop()}`,
                        filesystem: 'ext4',
                      }}
                      label={`${t('node.createDir')} ${dev}`}
                      size="small"
                      onDone={() => {
                        invalidate()
                        message.success(t('node.diskTaskDone'))
                      }}
                    />
                  ))}
                </Space>
                <PveGrid<DirRow>
                  connectionId={connectionId}
                  method="GET"
                  path="/nodes/{node}/disks/directory"
                  params={{ node }}
                  rowKey="path"
                  columns={[
                    { title: 'Path', dataIndex: 'path' },
                    { title: t('node.disk'), dataIndex: 'device', width: 140 },
                    { title: t('storage.type'), dataIndex: 'type', width: 90 },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'lvm',
            label: 'LVM',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Typography.Text type="secondary">{t('node.lvmHint')}</Typography.Text>
                <Space wrap>
                  {freeDevs.slice(0, 2).map((dev) => (
                    <TaskButton
                      key={dev}
                      connectionId={connectionId}
                      method="POST"
                      path="/nodes/{node}/disks/lvm"
                      params={{ node, device: dev, name: `vg-${dev.split('/').pop()}` }}
                      label={`${t('node.createLvm')} ${dev}`}
                      size="small"
                      onDone={invalidate}
                    />
                  ))}
                </Space>
                <PveGrid<ThinRow>
                  connectionId={connectionId}
                  method="GET"
                  path="/nodes/{node}/disks/lvmthin"
                  params={{ node }}
                  rowKey="lv"
                  columns={[
                    { title: 'LV', dataIndex: 'lv', width: 120 },
                    { title: 'VG', dataIndex: 'vg', width: 100 },
                    {
                      title: t('storage.size'),
                      dataIndex: 'lv_size',
                      render: (v?: number) => (v ? formatBytes(v) : '—'),
                    },
                    {
                      title: t('storage.used'),
                      dataIndex: 'used',
                      render: (v?: number) => (v ? formatBytes(v) : '—'),
                    },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'zfs',
            label: 'ZFS',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {freeDevs[0] && (
                  <TaskButton
                    connectionId={connectionId}
                    method="POST"
                    path="/nodes/{node}/disks/zfs"
                    params={{
                      node,
                      name: `tank-${node}`,
                      devices: freeDevs[0],
                      raidlevel: 'single',
                    }}
                    label={`${t('node.createZfs')} ${freeDevs[0]}`}
                    size="small"
                    onDone={invalidate}
                  />
                )}
                <PveGrid<ZfsRow>
                  connectionId={connectionId}
                  method="GET"
                  path="/nodes/{node}/disks/zfs"
                  params={{ node }}
                  rowKey="name"
                  emptyText={t('node.zfsEmpty')}
                  columns={[
                    { title: 'Pool', dataIndex: 'name', width: 140 },
                    {
                      title: t('storage.size'),
                      dataIndex: 'size',
                      render: (v?: number) => (v ? formatBytes(v) : '—'),
                    },
                    {
                      title: t('storage.avail'),
                      dataIndex: 'free',
                      render: (v?: number) => (v ? formatBytes(v) : '—'),
                    },
                    {
                      title: t('node.health'),
                      dataIndex: 'health',
                      width: 110,
                      render: (h?: string) => (
                        <Tag color={h === 'ONLINE' ? 'success' : 'warning'}>{h}</Tag>
                      ),
                    },
                  ]}
                />
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={smartDisk !== null}
        title={`SMART — ${smartDisk}`}
        onCancel={() => setSmartDisk(null)}
        footer={null}
        destroyOnHidden
        width={560}
      >
        {smartQuery.isLoading ? (
          <Typography.Text>{t('common.loading')}</Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label={t('node.health')}>
                {smartQuery.data?.health ?? '—'}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
              {smartQuery.data?.text}
            </Typography.Paragraph>
          </Space>
        )}
      </Modal>
    </>
  )
}
