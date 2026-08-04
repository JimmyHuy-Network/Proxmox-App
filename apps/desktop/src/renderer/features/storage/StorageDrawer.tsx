import { useState } from 'react'
import {
  Badge,
  Button,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RrdChart, formatBytes, formatPercent } from '../../components/RrdChart'
import { TaskButton } from '../../components/TaskButton'
import { PveForm } from '../../components/PveForm'
import { useConnections } from '../../stores/connections'
import { useSelection } from '../../stores/selection'
import { useTasks } from '../../stores/tasks'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { isUpid } from '@pve/api'
import { ContentTab } from './ContentTab'
import { BackupJobsTab } from './BackupJobsTab'
import { RestoreWizard } from './RestoreWizard'
import { StorageFormModal } from './StorageFormModal'

interface StorageStatus {
  storage: string
  type?: string
  content?: string
  total?: number
  used?: number
  avail?: number
  active?: number | boolean
  enabled?: number | boolean
  shared?: number | boolean
}

interface VzdumpValues {
  [key: string]: unknown
  vmid: string
  storage: string
  mode: string
  compress: string
}

/**
 * Drawer chi tiết storage: tổng quan, content, backup jobs, vzdump ngay.
 */
export function StorageDrawer(): React.JSX.Element {
  const { t } = useTranslation()
  const storageRes = useSelection((s) => s.selectedStorage)
  const select = useSelection((s) => s.select)
  const activeId = useConnections((s) => s.activeId)
  const addTask = useTasks((s) => s.addTask)
  const queryClient = useQueryClient()

  const [restoreArchive, setRestoreArchive] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [vzdumpOpen, setVzdumpOpen] = useState(false)
  const [vzdumpForm] = Form.useForm<VzdumpValues>()

  const open = storageRes !== null && activeId !== null
  const node = storageRes?.node
  const storage = storageRes?.storage

  const canQuery = open && Boolean(node) && Boolean(storage)

  const statusQuery = useQuery({
    queryKey: canQuery
      ? pveQueryKey(activeId!, 'GET', '/nodes/{node}/storage/{storage}/status', { node, storage })
      : ['storage-status', 'idle'],
    queryFn: () =>
      pveRequest<StorageStatus>(activeId!, 'GET', '/nodes/{node}/storage/{storage}/status', {
        node,
        storage,
      }),
    enabled: canQuery,
    refetchInterval: 5000,
  })

  const rrdQuery = useQuery({
    queryKey: canQuery
      ? pveQueryKey(activeId!, 'GET', '/nodes/{node}/storage/{storage}/rrddata', {
          node,
          storage,
          timeframe: 'hour',
        })
      : ['storage-rrd', 'idle'],
    queryFn: () =>
      pveRequest<Record<string, number>[]>(activeId!, 'GET', '/nodes/{node}/storage/{storage}/rrddata', {
        node,
        storage,
        timeframe: 'hour',
      }),
    enabled: canQuery,
    refetchInterval: 15_000,
  })

  const contentTypes = (statusQuery.data?.content ?? storageRes?.content ?? '')
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const title = (
    <Flex align="center" gap={8}>
      <Typography.Text strong>{storage}</Typography.Text>
      {statusQuery.data?.type && <Tag>{statusQuery.data.type}</Tag>}
      <Badge
        status={statusQuery.data?.active ? 'success' : 'default'}
        text={statusQuery.data?.active ? t('storage.active') : t('storage.inactive')}
      />
    </Flex>
  )

  return (
    <>
      <Drawer
        open={open}
        size={880}
        title={title}
        onClose={() => select(null)}
        destroyOnHidden
        extra={
          <Space>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              {t('storage.addStorage')}
            </Button>
            {canQuery && contentTypes.includes('backup') && (
              <Button size="small" onClick={() => setVzdumpOpen(true)}>
                {t('storage.backupNow')}
              </Button>
            )}
            {canQuery && contentTypes.includes('backup') && (
              <TaskButton
                connectionId={activeId!}
                method="DELETE"
                path="/nodes/{node}/storage/{storage}/prunebackups"
                params={{ node, storage }}
                label={t('storage.prune')}
                size="small"
                confirmMessage={t('storage.pruneConfirm')}
                onDone={() =>
                  void queryClient.invalidateQueries({
                    queryKey: pveQueryKey(activeId!, 'GET', '/nodes/{node}/storage/{storage}/content', {
                      node,
                      storage,
                    }),
                  })
                }
              />
            )}
          </Space>
        }
      >
        {!canQuery ? (
          <Skeleton active />
        ) : (
          <Tabs
            items={[
              {
                key: 'overview',
                label: t('storage.tabOverview'),
                children: (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    {statusQuery.isLoading ? (
                      <Skeleton active />
                    ) : (
                      <Descriptions size="small" column={2} bordered>
                        <Descriptions.Item label={t('storage.type')}>
                          {statusQuery.data?.type ?? storageRes?.plugintype ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label={t('storage.contentType')}>
                          {statusQuery.data?.content ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label={t('storage.used')}>
                          {formatBytes(statusQuery.data?.used ?? 0)} /{' '}
                          {formatBytes(statusQuery.data?.total ?? 0)} (
                          {formatPercent(
                            (statusQuery.data?.used ?? 0) / Math.max(1, statusQuery.data?.total ?? 1),
                          )}
                          )
                        </Descriptions.Item>
                        <Descriptions.Item label={t('storage.avail')}>
                          {formatBytes(statusQuery.data?.avail ?? 0)}
                        </Descriptions.Item>
                        <Descriptions.Item label="Node">{node}</Descriptions.Item>
                        <Descriptions.Item label={t('storage.shared')}>
                          {statusQuery.data?.shared ? t('common.ok') : '—'}
                        </Descriptions.Item>
                      </Descriptions>
                    )}
                    <RrdChart
                      points={rrdQuery.data ?? []}
                      series={[
                        { key: 'disk', label: t('storage.used'), color: '#1677ff' },
                        { key: 'maxdisk', label: t('storage.total'), color: '#8c8c8c' },
                      ]}
                    />
                  </Space>
                ),
              },
              {
                key: 'content',
                label: t('storage.tabContent'),
                children: (
                  <ContentTab
                    connectionId={activeId!}
                    node={node!}
                    storage={storage!}
                    contentTypes={contentTypes}
                    storageType={statusQuery.data?.type ?? storageRes?.plugintype}
                    onRestore={(volid) => setRestoreArchive(volid)}
                  />
                ),
              },
              {
                key: 'backup',
                label: t('storage.tabBackupJobs'),
                children: <BackupJobsTab connectionId={activeId!} defaultNode={node!} />,
              },
            ]}
          />
        )}
      </Drawer>

      <RestoreWizard
        open={restoreArchive !== null}
        connectionId={activeId ?? ''}
        node={node ?? 'pve1'}
        archive={restoreArchive}
        onClose={() => setRestoreArchive(null)}
      />

      <StorageFormModal
        open={addOpen}
        connectionId={activeId ?? ''}
        scanNode={node ?? 'pve1'}
        onClose={() => setAddOpen(false)}
      />

      <Modal
        open={vzdumpOpen}
        title={t('storage.backupNow')}
        onCancel={() => setVzdumpOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <PveForm<VzdumpValues>
          form={vzdumpForm}
          submitText={t('storage.backupNow')}
          initialValues={{
            storage: storage ?? 'local',
            mode: 'snapshot',
            compress: 'zstd',
            vmid: '100',
          }}
          onFinish={async (values) => {
            const upid = await pveRequest<string>(activeId!, 'POST', '/nodes/{node}/vzdump', {
              node,
              ...values,
            })
            if (isUpid(upid)) addTask(activeId!, upid)
            setVzdumpOpen(false)
          }}
        >
          <Form.Item name="vmid" label="VMID" rules={[{ required: true }]}>
            <Input placeholder="100,101" />
          </Form.Item>
          <Form.Item name="storage" label="Storage">
            <Input />
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
              ]}
            />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}
