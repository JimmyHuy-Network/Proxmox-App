import { useMemo, useState } from 'react'
import { Empty, Flex, Input, Spin, Tag, Tree, Typography, theme } from 'antd'
import {
  CloudServerOutlined,
  ContainerOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { useTranslation } from 'react-i18next'
import { useClusterResources } from '../../hooks/useClusterResources'
import { useSelection } from '../../stores/selection'
import { NodeShellButton } from '../console/NodeShellButton'
import { LedDot, ledKindFromResourceStatus } from '../../components/TechUi'
import { PVE_COLORS } from '../../theme/tokens'
import { isGuest, type ClusterResource } from './types'

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

function GuestIcon({ type }: { type: string }): React.JSX.Element {
  if (type === 'lxc') return <ContainerOutlined style={{ color: PVE_COLORS.info }} />
  return <DesktopOutlined style={{ color: PVE_COLORS.primary }} />
}

function isDegraded(r: ClusterResource): boolean {
  if (r.type === 'node' && r.status && r.status !== 'online') return true
  if (isGuest(r) && r.lock) return true
  if (typeof r.cpu === 'number' && r.cpu > 0.9) return true
  if (typeof r.maxdisk === 'number' && r.maxdisk > 0 && typeof r.disk === 'number' && r.disk / r.maxdisk > 0.85) {
    return true
  }
  return false
}

/**
 * Cây tài nguyên Hi-Tech: LED status + neon hover (không nhồi CPU/RAM mọi hàng).
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
  const selectedTreeKey = selectedKey ? `res:${selectedKey}` : undefined

  const treeData = useMemo<DataNode[]>(() => {
    const rows = resources as ClusterResource[]
    const nodes = rows.filter((r) => r.type === 'node').sort((a, b) => (a.node ?? '').localeCompare(b.node ?? ''))

    const nodeChildren = (nodeName: string): DataNode[] => {
      const children = rows.filter((r) => r.node === nodeName && (isGuest(r) || r.type === 'storage'))
      const filtered = query.trim() === '' ? children : children.filter((r) => matches(r, query))

      return filtered
        .sort((a, b) => {
          if (isGuest(a) !== isGuest(b)) return isGuest(a) ? -1 : 1
          return (a.vmid ?? 0) - (b.vmid ?? 0) || (a.name ?? a.storage ?? '').localeCompare(b.name ?? b.storage ?? '')
        })
        .map((r) => ({
          key: `res:${r.id}`,
          isLeaf: true,
          selectable: isGuest(r) || r.type === 'storage',
          title: isGuest(r) ? (
            <Flex className="resource-tree-row" align="center" gap={6}>
              <LedDot kind={ledKindFromResourceStatus({ type: r.type, status: r.status })} />
              <GuestIcon type={r.type} />
              <span style={{ fontSize: 12 }}>{guestLabel(r)}</span>
              {r.template === 1 && <Tag style={{ marginInlineStart: 4 }}>Template</Tag>}
              {isDegraded(r) && <WarningOutlined style={{ color: PVE_COLORS.warning, fontSize: 11 }} />}
            </Flex>
          ) : (
            <Flex className="resource-tree-row" align="center" gap={6}>
              <LedDot kind={ledKindFromResourceStatus({ type: 'storage', status: r.status })} />
              <DatabaseOutlined style={{ color: token.colorTextTertiary }} />
              <Typography.Text style={{ fontSize: 12 }}>{r.storage}</Typography.Text>
              {r.plugintype && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
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
      if (query.trim() !== '' && children.length === 0) continue
      const nodeName = n.node ?? ''
      nodeEntries.push({
        key: `res:${n.id}`,
        selectable: true,
        title: (
          <Flex
            className="resource-tree-row"
            align="center"
            gap={6}
            justify="space-between"
            style={{ width: '100%', paddingInlineEnd: 4, cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              select(n)
            }}
          >
            <Flex align="center" gap={6}>
              <LedDot kind={ledKindFromResourceStatus({ type: 'node', status: n.status })} />
              <CloudServerOutlined style={{ color: PVE_COLORS.info }} />
              <Typography.Text strong style={{ fontSize: 12 }}>
                {nodeName}
              </Typography.Text>
              {isDegraded(n) && <WarningOutlined style={{ color: PVE_COLORS.warning, fontSize: 11 }} />}
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
  }, [resources, query, token, connectionId, select])

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
          className="neon-border"
        />
      </div>

      {treeData.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={query ? t('tree.noMatch') : t('tree.empty')}
          style={{ marginTop: 24 }}
        />
      ) : (
        <Tree
          treeData={treeData}
          defaultExpandedKeys={allNodeKeys}
          selectedKeys={selectedTreeKey ? [selectedTreeKey] : []}
          expandAction="doubleClick"
          onSelect={(_keys, info) => {
            const raw = String(info.node.key).replace(/^res:/, '')
            const resource = (resources as ClusterResource[]).find((r) => r.id === raw)
            if (!resource) return
            if (resource.type === 'node' || isGuest(resource) || resource.type === 'storage') {
              select(resource)
            }
          }}
          style={{ flex: 1, overflow: 'auto', paddingInline: 4, background: 'transparent' }}
        />
      )}
    </Flex>
  )
}
