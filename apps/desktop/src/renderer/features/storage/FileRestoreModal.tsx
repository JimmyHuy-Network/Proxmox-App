import { useState } from 'react'
import { App, Breadcrumb, Button, Modal, Space, Table, Typography } from 'antd'
import { DownloadOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '../../components/RrdChart'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { useTransfers } from '../../stores/transfers'

interface FileEntry {
  filepath: string
  text?: string
  type?: string
  size?: number
  leaf?: number | boolean
}

function encodePath(path: string): string {
  return btoa(unescape(encodeURIComponent(path)))
}

function decodePath(b64: string): string {
  if (!b64 || b64 === '/') return '/'
  try {
    return decodeURIComponent(escape(atob(b64))) || '/'
  } catch {
    return b64
  }
}

/**
 * Duyệt / tải file từ bản backup PBS (`file-restore/list` + download).
 */
export function FileRestoreModal({
  open,
  connectionId,
  node,
  storage,
  volume,
  onClose,
}: {
  open: boolean
  connectionId: string
  node: string
  storage: string
  volume: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [filepath, setFilepath] = useState('/')
  const [downloading, setDownloading] = useState(false)

  const listQuery = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/storage/{storage}/file-restore/list', {
      node,
      storage,
      volume,
      filepath,
    }),
    queryFn: () =>
      pveRequest<FileEntry[]>(connectionId, 'GET', '/nodes/{node}/storage/{storage}/file-restore/list', {
        node,
        storage,
        volume,
        filepath,
      }),
    enabled: open && Boolean(volume),
  })

  const crumbs = (() => {
    const path = decodePath(filepath)
    if (path === '/') return [{ title: '/', onClick: () => setFilepath('/') }]
    const parts = path.split('/').filter(Boolean)
    const items = [{ title: '/', onClick: () => setFilepath('/') }]
    let acc = ''
    for (const part of parts) {
      acc += `/${part}`
      items.push({ title: part, onClick: () => setFilepath(encodePath(acc)) })
    }
    return items
  })()

  const downloadEntry = async (entry: FileEntry): Promise<void> => {
    setDownloading(true)
    try {
      const res = await window.pve.transfer.download({
        connectionId,
        node,
        storage,
        volume,
        filepath: entry.filepath,
      })
      if (!res.ok) {
        message.error(res.message)
        return
      }
      const transferId = res.data.transferId
      await new Promise<void>((resolve) => {
        const unsub = useTransfers.subscribe((state) => {
          const tr = state.items[transferId]
          if (!tr) return
          if (tr.phase !== 'done' && tr.phase !== 'error' && tr.phase !== 'cancelled') return
          unsub()
          if (tr.phase === 'done') message.success(t('storage.fileRestoreDownloaded'))
          else if (tr.phase === 'error') message.error(tr.message ?? t('storage.downloadFailed'))
          useTransfers.getState().clear(transferId)
          resolve()
        })
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('storage.fileRestore')}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnHidden
      afterOpenChange={(isOpen) => {
        if (!isOpen) setFilepath('/')
      }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary" ellipsis>
          {volume}
        </Typography.Text>
        <Breadcrumb
          items={crumbs.map((c) => ({
            title: (
              <Button type="link" size="small" onClick={c.onClick} style={{ padding: 0 }}>
                {c.title}
              </Button>
            ),
          }))}
        />
        <Table<FileEntry>
          size="small"
          rowKey="filepath"
          loading={listQuery.isLoading}
          dataSource={listQuery.data ?? []}
          pagination={false}
          columns={[
            {
              title: t('storage.filename'),
              dataIndex: 'text',
              render: (text: string | undefined, row) => (
                <Space>
                  {row.type === 'd' || row.leaf === 0 || row.leaf === false ? (
                    <FolderOpenOutlined />
                  ) : null}
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={() => {
                      if (row.type === 'd' || row.leaf === 0 || row.leaf === false) {
                        setFilepath(row.filepath)
                      }
                    }}
                  >
                    {text ?? decodePath(row.filepath).split('/').pop()}
                  </Button>
                </Space>
              ),
            },
            {
              title: t('storage.size'),
              dataIndex: 'size',
              width: 110,
              render: (v: number | undefined) => (v ? formatBytes(v) : '—'),
            },
            {
              title: '',
              key: 'dl',
              width: 100,
              render: (_, row) =>
                row.type === 'f' || row.leaf === 1 || row.leaf === true ? (
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={downloading}
                    onClick={() => void downloadEntry(row)}
                  >
                    {t('storage.download')}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Space>
    </Modal>
  )
}
