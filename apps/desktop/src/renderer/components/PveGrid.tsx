import { useState } from 'react'
import { Alert, Empty, Flex, Input, Table, type TableProps } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import type { PveHttpMethod } from '@pve/ipc'
import { pveQueryKey, pveRequest } from '../lib/pve'

/**
 * Wrapper mỏng quanh antd `Table` cho các endpoint Proxmox trả về mảng.
 *
 * Đây là một trong hai trừu tượng cốt lõi của giai đoạn 4 (xem docs/plan.md mục 7):
 * mỗi view danh sách phải gói gọn dưới ~40 dòng bằng cách khai `endpoint`/`columns`
 * thay vì tự viết `useQuery` + `Table` mỗi nơi.
 *
 * KHÔNG dùng cho dữ liệu đã có sẵn qua push-event (cây tài nguyên, danh sách guest
 * toàn cụm) — những nơi đó đọc thẳng từ store `resources` để tránh poll trùng.
 * PveGrid dành cho danh sách gọi theo yêu cầu: snapshot, storage content, users…
 */
export function PveGrid<T extends Record<string, unknown>>({
  connectionId,
  method,
  path,
  params,
  columns,
  rowKey,
  refetchInterval,
  search,
  searchPlaceholder,
  toolbar,
  emptyText,
  onRow,
  transform,
}: {
  connectionId: string
  method: PveHttpMethod
  path: string
  params?: Record<string, unknown>
  columns: TableProps<T>['columns']
  rowKey: string | ((row: T) => string)
  refetchInterval?: number
  search?: (row: T, query: string) => boolean
  searchPlaceholder?: string
  toolbar?: React.ReactNode
  emptyText?: string
  onRow?: TableProps<T>['onRow']
  /** Sắp xếp / gắn metadata trước khi lọc và render (vd. cây snapshot). */
  transform?: (rows: T[]) => T[]
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const q = useQuery({
    queryKey: pveQueryKey(connectionId, method, path, params),
    queryFn: () => pveRequest<T[]>(connectionId, method, path, params),
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
  })

  const rows = transform ? transform(q.data ?? []) : (q.data ?? [])
  const filtered = search && query.trim() !== '' ? rows.filter((r) => search(r, query)) : rows

  return (
    <Flex vertical gap={12}>
      {(search ?? toolbar) !== undefined && (
        <Flex justify="space-between" align="center">
          {search ? (
            <Input
              allowClear
              style={{ maxWidth: 280 }}
              prefix={<SearchOutlined />}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : (
            <div />
          )}
          {toolbar}
        </Flex>
      )}

      {q.isError ? (
        <Alert
          type="error"
          showIcon
          message={q.error instanceof Error ? q.error.message : 'Không tải được dữ liệu'}
          action={
            <a onClick={() => void q.refetch()}>
              <ReloadOutlined />
            </a>
          }
        />
      ) : (
        <Table<T>
          size="small"
          rowKey={rowKey}
          loading={q.isLoading}
          dataSource={filtered}
          columns={columns}
          onRow={onRow}
          pagination={filtered.length > 20 ? { pageSize: 20, size: 'small' } : false}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText ?? 'Không có dữ liệu'} />
            ),
          }}
        />
      )}
    </Flex>
  )
}
