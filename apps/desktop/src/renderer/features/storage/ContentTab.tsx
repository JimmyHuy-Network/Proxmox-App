import { useState } from 'react'
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import { CloudDownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { TaskButton } from '../../components/TaskButton'
import { PveForm } from '../../components/PveForm'
import { PveGrid } from '../../components/PveGrid'
import { formatBytes } from '../../components/RrdChart'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { useTransfers } from '../../stores/transfers'
import { useTasks } from '../../stores/tasks'

interface VolumeRow {
  [key: string]: unknown
  volid: string
  format?: string
  size?: number
  content?: string
  ctime?: number
  vmid?: number
  notes?: string
  protected?: number | boolean
}

interface DownloadUrlValues {
  [key: string]: unknown
  content: string
  filename: string
  url: string
}

/**
 * Duyệt nội dung storage: xoá, notes/protect, upload, download-url.
 */
export function ContentTab({
  connectionId,
  node,
  storage,
  contentTypes,
  onRestore,
}: {
  connectionId: string
  node: string
  storage: string
  contentTypes: string[]
  onRestore?: (volid: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [contentFilter, setContentFilter] = useState<string | undefined>()
  const [uploadContent, setUploadContent] = useState(
    contentTypes.find((c) => c === 'iso' || c === 'vztmpl') ?? contentTypes[0] ?? 'iso',
  )
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState<VolumeRow | null>(null)
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null)
  const [downloadForm] = Form.useForm<DownloadUrlValues>()
  const [notesForm] = Form.useForm<{ notes?: string; protected?: boolean }>()
  const addTask = useTasks((s) => s.addTask)
  const transfer = useTransfers((s) => (activeTransferId ? s.items[activeTransferId] : undefined))

  const params = {
    node,
    storage,
    ...(contentFilter ? { content: contentFilter } : {}),
  }
  const listKey = pveQueryKey(connectionId, 'GET', '/nodes/{node}/storage/{storage}/content', params)
  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: listKey })

  const uploadable = contentTypes.filter((c) => c === 'iso' || c === 'vztmpl' || c === 'import')

  const startUpload = async (): Promise<void> => {
    const res = await window.pve.transfer.upload({
      connectionId,
      node,
      storage,
      content: uploadContent,
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const transferId = res.data.transferId
    setActiveTransferId(transferId)
    message.info(t('storage.uploadStarted'))

    // Chờ sự kiện kết thúc (store cũng nhận qua subscribePveEvents).
    await new Promise<void>((resolve) => {
      const unsub = useTransfers.subscribe((state) => {
        const tr = state.items[transferId]
        if (!tr) return
        if (tr.phase !== 'done' && tr.phase !== 'error' && tr.phase !== 'cancelled') return
        unsub()
        if (tr.phase === 'done') {
          if (tr.upid) addTask(connectionId, tr.upid)
          invalidate()
          message.success(t('storage.uploadDone'))
        } else if (tr.phase === 'error') {
          message.error(tr.message ?? t('storage.uploadFailed'))
        } else {
          message.warning(t('storage.uploadCancelled'))
        }
        useTransfers.getState().clear(transferId)
        setActiveTransferId(null)
        resolve()
      })
    })
  }

  const inProgress =
    Boolean(activeTransferId) &&
    (!transfer || transfer.phase === 'started' || transfer.phase === 'progress')
  const percent =
    transfer && transfer.totalBytes > 0
      ? Math.min(99, Math.round((transfer.bytesSent / transfer.totalBytes) * 100))
      : 0

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PveGrid<VolumeRow>
        connectionId={connectionId}
        method="GET"
        path="/nodes/{node}/storage/{storage}/content"
        params={params}
        rowKey="volid"
        refetchInterval={5000}
        emptyText={t('storage.contentEmpty')}
        search={(row, q) =>
          row.volid.toLowerCase().includes(q.toLowerCase()) ||
          (row.notes?.toLowerCase().includes(q.toLowerCase()) ?? false)
        }
        searchPlaceholder={t('storage.contentSearch')}
        toolbar={
          <Space wrap>
            <Select
              allowClear
              placeholder={t('storage.contentFilter')}
              style={{ minWidth: 140 }}
              value={contentFilter}
              onChange={(v) => setContentFilter(v)}
              options={contentTypes.map((c) => ({ value: c, label: c }))}
            />
            {uploadable.length > 0 && (
              <>
                <Select
                  style={{ minWidth: 100 }}
                  value={uploadContent}
                  onChange={setUploadContent}
                  options={uploadable.map((c) => ({ value: c, label: c }))}
                />
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => void startUpload()}
                  disabled={Boolean(activeTransferId)}
                >
                  {t('storage.upload')}
                </Button>
                <Button icon={<CloudDownloadOutlined />} onClick={() => setDownloadOpen(true)}>
                  {t('storage.downloadUrl')}
                </Button>
              </>
            )}
          </Space>
        }
        columns={[
          {
            title: t('storage.volid'),
            dataIndex: 'volid',
            ellipsis: true,
            render: (v: string, row) => (
              <Space>
                <span>{v}</span>
                {row.protected ? <Tag color="orange">{t('storage.protected')}</Tag> : null}
              </Space>
            ),
          },
          { title: t('storage.contentType'), dataIndex: 'content', width: 100 },
          { title: t('storage.format'), dataIndex: 'format', width: 90 },
          {
            title: t('storage.size'),
            dataIndex: 'size',
            width: 110,
            render: (v: number | undefined) => (v !== undefined ? formatBytes(v) : '—'),
          },
          {
            title: t('storage.ctime'),
            dataIndex: 'ctime',
            width: 160,
            render: (v: number | undefined) => (v ? new Date(v * 1000).toLocaleString() : '—'),
          },
          {
            title: '',
            key: 'actions',
            width: 280,
            render: (_, row) => (
              <Space size={4}>
                <Button
                  size="small"
                  onClick={() => {
                    setNotesOpen(row)
                    notesForm.setFieldsValue({
                      notes: row.notes,
                      protected: Boolean(row.protected),
                    })
                  }}
                >
                  {t('storage.editNotes')}
                </Button>
                {row.content === 'backup' && onRestore && (
                  <Button size="small" onClick={() => onRestore(row.volid)}>
                    {t('storage.restore')}
                  </Button>
                )}
                <TaskButton
                  connectionId={connectionId}
                  method="DELETE"
                  path="/nodes/{node}/storage/{storage}/content/{volume}"
                  params={{ node, storage, volume: row.volid }}
                  label={t('common.delete')}
                  danger
                  size="small"
                  confirmMessage={t('storage.deleteConfirm')}
                  onDone={invalidate}
                />
              </Space>
            ),
          },
        ]}
      />

      {activeTransferId && inProgress && transfer && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>
            {t('storage.uploadProgress')} — {formatBytes(transfer.bytesSent)}
            {transfer.totalBytes > 0 ? ` / ${formatBytes(transfer.totalBytes)}` : ''}
          </Typography.Text>
          <Progress percent={percent} status="active" />
          <Button size="small" danger onClick={() => void window.pve.transfer.cancel(activeTransferId)}>
            {t('common.cancel')}
          </Button>
        </Space>
      )}

      <Modal
        open={downloadOpen}
        title={t('storage.downloadUrl')}
        onCancel={() => setDownloadOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <PveForm<DownloadUrlValues>
          form={downloadForm}
          submitText={t('storage.downloadUrl')}
          initialValues={{ content: uploadable[0] ?? 'iso' }}
          onFinish={async (values) => {
            const upid = await pveRequest<string>(
              connectionId,
              'POST',
              '/nodes/{node}/storage/{storage}/download-url',
              { node, storage, ...values },
            )
            if (typeof upid === 'string') addTask(connectionId, upid)
            setDownloadOpen(false)
            downloadForm.resetFields()
            message.success(t('storage.downloadUrlStarted'))
            invalidate()
          }}
        >
          <Form.Item name="content" label={t('storage.contentType')} rules={[{ required: true }]}>
            <Select options={uploadable.map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item name="filename" label={t('storage.filename')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true }]}>
            <Input placeholder="https://…" />
          </Form.Item>
        </PveForm>
      </Modal>

      <Modal
        open={notesOpen !== null}
        title={t('storage.editNotes')}
        onCancel={() => setNotesOpen(null)}
        footer={null}
        destroyOnHidden
      >
        {notesOpen && (
          <PveForm
            form={notesForm}
            submitText={t('common.save')}
            onFinish={async (values) => {
              await pveRequest(connectionId, 'PUT', '/nodes/{node}/storage/{storage}/content/{volume}', {
                node,
                storage,
                volume: notesOpen.volid,
                notes: values.notes,
                protected: values.protected ? 1 : 0,
              })
              setNotesOpen(null)
              invalidate()
              message.success(t('storage.notesSaved'))
            }}
          >
            <Form.Item name="notes" label={t('storage.notes')}>
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="protected" label={t('storage.protected')} valuePropName="checked">
              <Checkbox />
            </Form.Item>
          </PveForm>
        )}
      </Modal>
    </Space>
  )
}
