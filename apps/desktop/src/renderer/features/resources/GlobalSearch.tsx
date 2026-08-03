import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Flex, Input, Modal, Progress, Space, Tag, Typography } from 'antd'
import {
  CodeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useClusterResources } from '../../hooks/useClusterResources'
import { useSelection } from '../../stores/selection'
import { TaskButton } from '../../components/TaskButton'
import { LedDot, ledKindFromResourceStatus } from '../../components/TechUi'
import { formatBytes } from '../../components/RrdChart'
import { PVE_COLORS } from '../../theme/tokens'
import { isGuest, type ClusterResource } from './types'

function matches(r: ClusterResource, q: string): boolean {
  const needle = q.toLowerCase()
  return (
    r.id.toLowerCase().includes(needle) ||
    (r.name?.toLowerCase().includes(needle) ?? false) ||
    String(r.vmid ?? '').includes(needle) ||
    (r.storage?.toLowerCase().includes(needle) ?? false) ||
    (r.node?.toLowerCase().includes(needle) ?? false) ||
    (r.tags?.toLowerCase().includes(needle) ?? false)
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 11, letterSpacing: 0.08, textTransform: 'uppercase' }}
      >
        {title}
      </Typography.Text>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  )
}

/**
 * Global search — glass modal grouped theo mockup ui_resource_tree_search.
 */
export function GlobalSearch({ connectionId }: { connectionId: string | null }): React.JSX.Element {
  const { t } = useTranslation()
  const { resources } = useClusterResources(connectionId)
  const select = useSelection((s) => s.select)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (connectionId) setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connectionId])

  const filtered = useMemo(() => {
    const q = value.trim()
    const rows = (resources as ClusterResource[]).filter(
      (r) => isGuest(r) || r.type === 'storage' || r.type === 'node',
    )
    const hit = q ? rows.filter((r) => matches(r, q)) : rows
    return {
      qemu: hit.filter((r) => r.type === 'qemu').slice(0, 8),
      lxc: hit.filter((r) => r.type === 'lxc').slice(0, 8),
      storage: hit.filter((r) => r.type === 'storage').slice(0, 8),
      nodes: hit.filter((r) => r.type === 'node').slice(0, 8),
    }
  }, [resources, value])

  const total =
    filtered.qemu.length + filtered.lxc.length + filtered.storage.length + filtered.nodes.length

  const close = (): void => {
    setOpen(false)
    setValue('')
  }

  const pick = (r: ClusterResource): void => {
    select(r)
    close()
  }

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        disabled={!connectionId}
        data-global-search
        aria-label={t('nav.globalSearch')}
        onClick={() => connectionId && setOpen(true)}
      >
        <SearchOutlined />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('nav.globalSearch')}
        </span>
        <kbd>{t('nav.searchHint')}</kbd>
      </button>

      <Modal
        open={open}
        onCancel={close}
        footer={null}
        width={720}
        destroyOnHidden
        title={
          <Flex justify="space-between" align="center" style={{ paddingInlineEnd: 24 }}>
            <span>{t('search.title')}</span>
            <Typography.Text type="secondary" className="tech-mono" style={{ fontSize: 11 }}>
              {t('nav.searchHint')}
            </Typography.Text>
          </Flex>
        }
        className="neon-border-active tech-search-modal"
        styles={{
          body: {
            background: 'transparent',
          },
          mask: {
            backdropFilter: 'blur(8px)',
            background: 'rgba(5, 10, 20, 0.65)',
          },
        }}
      >
        <Input
          autoFocus
          size="large"
          allowClear
          prefix={<SearchOutlined style={{ color: PVE_COLORS.info }} />}
          placeholder={t('search.placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="neon-border"
          style={{ marginBottom: 16 }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        />

        {total === 0 ? (
          <Empty description={t('search.empty')} />
        ) : (
          <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
            {filtered.qemu.length > 0 && (
              <Section title={t('search.qemu')}>
                {filtered.qemu.map((r) => (
                  <GuestSearchRow
                    key={r.id}
                    r={r}
                    connectionId={connectionId!}
                    onPick={() => pick(r)}
                    consoleLabel={t('search.console')}
                    startLabel={t('guest.start')}
                    stopLabel={t('guest.stop')}
                  />
                ))}
              </Section>
            )}
            {filtered.lxc.length > 0 && (
              <Section title={t('search.lxc')}>
                {filtered.lxc.map((r) => (
                  <GuestSearchRow
                    key={r.id}
                    r={r}
                    connectionId={connectionId!}
                    onPick={() => pick(r)}
                    consoleLabel={t('search.console')}
                    startLabel={t('guest.start')}
                    stopLabel={t('guest.stop')}
                  />
                ))}
              </Section>
            )}
            {filtered.storage.length > 0 && (
              <Section title={t('search.storage')}>
                {filtered.storage.map((r) => {
                  const pct =
                    r.maxdisk && r.maxdisk > 0 && typeof r.disk === 'number'
                      ? Math.round((r.disk / r.maxdisk) * 100)
                      : 0
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pick(r)}
                      style={rowBtnStyle}
                    >
                      <Flex align="center" gap={10} style={{ width: '100%' }}>
                        <LedDot kind={ledKindFromResourceStatus({ type: 'storage', status: r.status })} />
                        <Tag>storage</Tag>
                        <Typography.Text strong style={{ flex: 1, textAlign: 'left' }}>
                          {r.storage ?? r.id}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {r.plugintype ?? r.node}
                        </Typography.Text>
                        <div style={{ width: 120 }}>
                          <Progress
                            percent={pct}
                            size="small"
                            showInfo
                            format={() => `${pct}%`}
                            strokeColor={PVE_COLORS.info}
                          />
                          <Typography.Text type="secondary" className="tech-mono" style={{ fontSize: 10 }}>
                            {formatBytes(r.disk ?? 0)} / {formatBytes(r.maxdisk ?? 0)}
                          </Typography.Text>
                        </div>
                      </Flex>
                    </button>
                  )
                })}
              </Section>
            )}
            {filtered.nodes.length > 0 && (
              <Section title={t('search.nodes')}>
                {filtered.nodes.map((r) => (
                  <button key={r.id} type="button" onClick={() => pick(r)} style={rowBtnStyle}>
                    <Flex align="center" gap={10} style={{ width: '100%' }}>
                      <LedDot kind={ledKindFromResourceStatus({ type: 'node', status: r.status })} />
                      <Tag>node</Tag>
                      <Typography.Text strong>{r.node ?? r.id}</Typography.Text>
                      <Typography.Text type="secondary" style={{ marginInlineStart: 'auto', fontSize: 12 }}>
                        {r.status === 'online' ? 'Online' : r.status ?? '—'}
                      </Typography.Text>
                    </Flex>
                  </button>
                ))}
              </Section>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}

const rowBtnStyle: React.CSSProperties = {
  width: '100%',
  display: 'block',
  textAlign: 'left',
  padding: '8px 10px',
  marginBottom: 4,
  borderRadius: 8,
  border: `1px solid ${PVE_COLORS.borderSecondary}`,
  background: 'rgba(11, 15, 25, 0.45)',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
}

function GuestSearchRow({
  r,
  connectionId,
  onPick,
  consoleLabel,
  startLabel,
  stopLabel,
}: {
  r: ClusterResource
  connectionId: string
  onPick: () => void
  consoleLabel: string
  startLabel: string
  stopLabel: string
}): React.JSX.Element {
  const running = r.status === 'running'
  const type = r.type as 'qemu' | 'lxc'
  const node = r.node!
  const vmid = r.vmid!
  const basePath = `/nodes/{node}/${type}/{vmid}`

  return (
    <div style={{ ...rowBtnStyle, cursor: 'default' }}>
      <Flex align="center" gap={10} wrap>
        <button type="button" onClick={onPick} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 160, padding: 0, font: 'inherit' }}>
          <LedDot kind={ledKindFromResourceStatus({ type: r.type, status: r.status })} />
          <Tag>{type}</Tag>
          <Typography.Text strong>
            {r.vmid} {r.name}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {r.node}
          </Typography.Text>
        </button>
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <TaskButton
            connectionId={connectionId}
            method="POST"
            path={`${basePath}/status/start`}
            params={{ node, vmid }}
            label={startLabel}
            icon={<PlayCircleOutlined />}
            size="small"
            disabled={running}
          />
          <TaskButton
            connectionId={connectionId}
            method="POST"
            path={`${basePath}/status/stop`}
            params={{ node, vmid }}
            label={stopLabel}
            icon={<PauseCircleOutlined />}
            size="small"
            danger
            disabled={!running}
          />
          <Button size="small" icon={<CodeOutlined />} onClick={onPick}>
            {consoleLabel}
          </Button>
        </Space>
      </Flex>
    </div>
  )
}
