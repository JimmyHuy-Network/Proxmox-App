import { useMemo, useState } from 'react'
import { Badge, Empty, Flex, Input, Spin, Tag, Tree, Typography, theme } from 'antd'
import { DatabaseOutlined, SearchOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { useTranslation } from 'react-i18next'
import { useClusterResources } from '../../hooks/useClusterResources'
import { useSelection } from '../../stores/selection'
import { NodeShellButton } from '../console/NodeShellButton'
import { isGuest, type ClusterResource } from './types'

type StatusBadge = 'success' | 'default' | 'error' | 'warning'

function statusOf(r: ClusterResource): StatusBadge {
  if (r.type === 'node') return r.status === 'online' ? 'success' : 'error'
  if (isGuest(r)) return r.status === 'running' ? 'success' : 'default'
  if (r.type === 'storage') return r.status === 'available' ? 'success' : 'warning'
  return 'default'
}

function guestLabel(r: ClusterResource): string {
  const kind = r.type === 'qemu' ? 'VM' : 'CT'
  return `${r.vmid ?? ''} ${r.name ?? ''} (${kind})`.trim()
}

function matches(r: ClusterResource, query: string): boolean {
  const q = query.toLowerCase()
  return (
    (r.name?.toLowerCase().includes(q) ?? false) ||
    String(r.vmid ?? '').includes(q) ||
    (r.storage?.toLowerCase().includes(q) ?? false)
  )
}

/**
 * Cây tài nguyên: Datacenter → Node → (VM/CT/Storage).
 *
 * Nguồn dữ liệu là store `resources`, đổ vào từ nhịp poll `/cluster/resources`
 * trong main — component này không tự gọi API, chỉ hiển thị.
 */
export function ResourceTree({ connectionId }: { connectionId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const { resources, at } = useClusterResources(connectionId)
  const [query, setQuery] = useState('')
  const select = useSelection((s) => s.select)
  const selectedGuest = useSelection((s) => s.selectedGuest)
  const selectedStorage = useSelection((s) => s.selectedStorage)
  const selectedNode = useSelection((s) => s.selectedNode)
  const selectedKey = selectedGuest?.id ?? selectedStorage?.id ?? selectedNode?.id

  const treeData = useMemo<DataNode[]>(() => {
    const rows = resources as ClusterResource[]
    const nodes = rows.filter((r) => r.type === 'node').sort((a, b) => (a.node ?? '').localeCompare(b.node ?? ''))

    const nodeChildren = (nodeName: string): DataNode[] => {
      const children = rows.filter(
        (r) => r.node === nodeName && (isGuest(r) || r.type === 'storage'),
      )

      const filtered = query.trim() === '' ? children : children.filter((r) => matches(r, query))

      return filtered
        .sort((a, b) => {
          // Guest trước storage, rồi theo vmid/tên.
          if (isGuest(a) !== isGuest(b)) return isGuest(a) ? -1 : 1
          return (a.vmid ?? 0) - (b.vmid ?? 0) || (a.name ?? a.storage ?? '').localeCompare(b.name ?? b.storage ?? '')
        })
        .map((r) => ({
          key: r.id,
          isLeaf: true,
          selectable: isGuest(r) || r.type === 'storage',
          title: isGuest(r) ? (
            <Flex align="center" gap={6}>
              <Badge status={statusOf(r)} />
              <span>{guestLabel(r)}</span>
              {r.template === 1 && <Tag style={{ marginInlineStart: 4 }}>Template</Tag>}
            </Flex>
          ) : (
            <Flex align="center" gap={6}>
              <DatabaseOutlined style={{ color: token.colorTextTertiary }} />
              <Typography.Text>{r.storage}</Typography.Text>
              {r.plugintype && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ({r.plugintype})
                </Typography.Text>
              )}
            </Flex>
          ),
        }))
    }

    const nodeEntries: DataNode[] = []
    for (const n of nodes) {
      const children = nodeChildren(n.node ?? '')
      // Ẩn node khỏi kết quả tìm kiếm nếu không có gì khớp bên trong, trừ khi
      // đang không lọc gì cả.
      if (query.trim() !== '' && children.length === 0) continue
      const nodeName = n.node ?? ''
      nodeEntries.push({
        key: n.id,
        selectable: true,
        title: (
          <Flex align="center" gap={6} justify="space-between" style={{ width: '100%', paddingInlineEnd: 4 }}>
            <Flex align="center" gap={6}>
              <Badge status={statusOf(n)} />
              <Typography.Text strong>{nodeName}</Typography.Text>
            </Flex>
            <span
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              <NodeShellButton connectionId={connectionId} node={nodeName} />
            </span>
          </Flex>
        ),
        children,
      })
    }
    return nodeEntries
  }, [resources, query, token, connectionId])

  const allNodeKeys = useMemo(() => treeData.map((n) => n.key), [treeData])

  if (at === null) {
    return (
      <Flex justify="center" style={{ padding: 24 }}>
        <Spin size="small" />
      </Flex>
    )
  }

  return (
    <Flex vertical style={{ height: '100%' }}>
      <div style={{ padding: '8px 12px' }}>
        <Input
          size="small"
          allowClear
          placeholder={t('common.search') ?? 'Tìm kiếm'}
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {treeData.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={query ? 'Không tìm thấy' : 'Chưa có tài nguyên'}
          style={{ marginTop: 24 }}
        />
      ) : (
        <Tree
          treeData={treeData}
          defaultExpandedKeys={allNodeKeys}
          selectedKeys={selectedKey ? [selectedKey] : []}
          onSelect={(_keys, info) => {
            const resource = (resources as ClusterResource[]).find((r) => r.id === info.node.key)
            if (!resource) return
            if (resource.type === 'node' || isGuest(resource) || resource.type === 'storage') {
              select(resource)
            }
          }}
          style={{ flex: 1, overflow: 'auto', paddingInline: 4 }}
        />
      )}
    </Flex>
  )
}
