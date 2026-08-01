import { Alert, Empty, Skeleton, Table } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface ConfigRow {
  key: string
  value: string
}

/**
 * Danh sách cấu hình thô của guest (`GET .../config`), chỉ đọc.
 *
 * Proxmox trả về một object phẳng gồm cả trường thường (`cores`, `memory`) lẫn
 * property string cho đĩa/mạng/PCI (`net0`, `scsi0`, `hostpci0`…). Codec phân
 * tích property string đã có sẵn ở `@pve/api` (`parsePropertyString`) nhưng
 * form sửa từng loại thiết bị là việc của một lượt sau — bảng này chỉ hiển thị
 * để xem nhanh, chưa cho sửa.
 */
export function HardwareTab({
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
  const path = `/nodes/{node}/${type}/{vmid}/config`
  const params = { node, vmid }

  const q = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', path, params),
    queryFn: () => pveRequest<Record<string, unknown>>(connectionId, 'GET', path, params),
  })

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />
  if (q.isError) {
    return <Alert type="error" showIcon message={q.error instanceof Error ? q.error.message : 'Lỗi'} />
  }

  const rows: ConfigRow[] = Object.entries(q.data ?? {})
    .map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) }))
    .sort((a, b) => a.key.localeCompare(b.key))

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('guest.hardwareEmpty')} />
  }

  return (
    <Table<ConfigRow>
      size="small"
      rowKey="key"
      pagination={false}
      dataSource={rows}
      columns={[
        { title: t('guest.hardwareKey'), dataIndex: 'key', width: 160 },
        { title: t('guest.hardwareValue'), dataIndex: 'value' },
      ]}
    />
  )
}
