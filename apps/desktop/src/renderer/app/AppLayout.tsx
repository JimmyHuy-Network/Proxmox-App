import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Divider, Dropdown, Flex, Layout, Menu, Space, Typography, theme } from 'antd'
import {
  ApiOutlined,
  BellOutlined,
  CodeOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DownOutlined,
  FileSearchOutlined,
  PlusOutlined,
  TeamOutlined,
  ApartmentOutlined,
  FireOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ConnectionPhase } from '@pve/ipc'
import { useConnections } from '../stores/connections'
import { subscribePveEvents } from '../lib/events'
import { ResourceTree } from '../features/resources/ResourceTree'
import { GlobalSearch } from '../features/resources/GlobalSearch'
import { TaskDock } from '../features/tasks/TaskDock'
import { GuestDrawer } from '../features/resources/GuestDrawer'
import { StorageDrawer } from '../features/storage/StorageDrawer'
import { NodeDrawer } from '../features/node/NodeDrawer'
import { useAppShortcuts } from '../hooks/useAppShortcuts'
import { AboutModal } from '../features/settings/AboutModal'
import { ShortcutsModal } from '../features/settings/ShortcutsModal'
import { useClusterResources } from '../hooks/useClusterResources'
import { pveQueryKey, pveRequest } from '../lib/pve'
import { CreateVmWizard } from '../features/resources/create-vm/CreateVmWizard'
import { CreateCtWizard } from '../features/resources/create-ct/CreateCtWizard'
import { type ClusterResource } from '../features/resources/types'
import { LedDot } from '../components/TechUi'
import appIcon from '../assets/app-icon.png'
import { PVE_COLORS } from '../theme/tokens'

const { Sider, Header, Content, Footer } = Layout

const PHASE_STATUS: Record<ConnectionPhase, 'success' | 'processing' | 'error' | 'default' | 'warning'> = {
  idle: 'default',
  connecting: 'processing',
  'cert-challenge': 'warning',
  'tfa-challenge': 'warning',
  authenticated: 'success',
  renewing: 'processing',
  degraded: 'warning',
  failed: 'error',
}

function ConnectionSwitcher(): React.JSX.Element | null {
  const { connections, activeId, phases, setActive } = useConnections()
  const active = connections.find((c) => c.id === activeId)
  const phase = (active && phases[active.id]) || 'idle'

  if (connections.length === 0) return null

  return (
    <Dropdown
      menu={{
        items: connections.map((c) => ({
          key: c.id,
          label: (
            <Space>
              <Badge status={PHASE_STATUS[phases[c.id] ?? 'idle']} />
              {c.name}
            </Space>
          ),
          onClick: () => setActive(c.id),
        })),
      }}
    >
      <Space className="neon-border" style={{ cursor: 'pointer', padding: '2px 10px', borderRadius: 8 }}>
        <ApiOutlined style={{ color: PVE_COLORS.info }} />
        {active ? active.name : '—'}
        <LedDot
          kind={
            phase === 'authenticated'
              ? 'online'
              : phase === 'failed'
                ? 'error'
                : phase === 'connecting' || phase === 'renewing'
                  ? 'info'
                  : 'warn'
          }
        />
        <DownOutlined style={{ fontSize: 10 }} />
      </Space>
    </Dropdown>
  )
}

function ClusterHealthChips({ connectionId }: { connectionId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { resources } = useClusterResources(connectionId)
  const nodes = (resources as ClusterResource[]).filter((r) => r.type === 'node')
  const online = nodes.filter((n) => n.status === 'online').length
  const clusterOk = nodes.length > 0 && online === nodes.length

  const joinQuery = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/cluster/config/join', {}),
    queryFn: () =>
      pveRequest<{ totem?: { cluster_name?: string } }>(connectionId, 'GET', '/cluster/config/join', {}),
    staleTime: 60_000,
  })

  const firstNode = nodes.find((n) => n.status === 'online')?.node ?? nodes[0]?.node
  const cephQuery = useQuery({
    queryKey: firstNode
      ? pveQueryKey(connectionId, 'GET', '/nodes/{node}/ceph/status', { node: firstNode })
      : ['ceph-health', 'idle'],
    queryFn: () =>
      pveRequest<{ health?: { status?: string } }>(connectionId, 'GET', '/nodes/{node}/ceph/status', {
        node: firstNode!,
      }),
    enabled: Boolean(firstNode),
    retry: false,
    staleTime: 30_000,
  })

  const cephStatus = cephQuery.data?.health?.status
  const showCeph = cephQuery.isSuccess && Boolean(cephStatus)

  return (
    <Flex gap={8} align="center" wrap>
      <span className="health-chip" title={joinQuery.data?.totem?.cluster_name}>
        <LedDot kind={clusterOk ? 'online' : nodes.length ? 'warn' : 'stopped'} />
        {t('nav.healthCluster')}{' '}
        <strong>{clusterOk ? t('nav.healthHealthy') : t('nav.healthUnknown')}</strong>
      </span>
      <span className="health-chip">
        <LedDot kind={online > 0 ? 'online' : 'stopped'} />
        {t('nav.healthQuorum')}{' '}
        <strong>{online > 0 ? t('nav.healthYes') : t('nav.healthUnknown')}</strong>
      </span>
      {showCeph ? (
        <span className="health-chip">
          <LedDot kind={cephStatus === 'HEALTH_OK' ? 'online' : 'warn'} />
          {t('nav.healthCeph')} <strong>{cephStatus === 'HEALTH_OK' ? t('nav.healthHealthy') : cephStatus}</strong>
        </span>
      ) : null}
    </Flex>
  )
}

/**
 * Khung giao diện chính — Hi-Tech shell bám mockup dashboard/search.
 */
export function AppLayout(): React.JSX.Element {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const refresh = useConnections((s) => s.refresh)
  const activeId = useConnections((s) => s.activeId)
  const activePhase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && activePhase === 'authenticated'
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [appVersion, setAppVersion] = useState<{ app?: string; electron?: string } | null>(null)
  const [createVmOpen, setCreateVmOpen] = useState(false)
  const [createCtOpen, setCreateCtOpen] = useState(false)
  const [vmWizardKey, setVmWizardKey] = useState(0)
  const [ctWizardKey, setCtWizardKey] = useState(0)

  const { resources } = useClusterResources(connected ? activeId : null)
  const nodeNames = useMemo(
    () =>
      (resources as ClusterResource[])
        .filter((r) => r.type === 'node' && r.node)
        .map((r) => r.node as string)
        .sort(),
    [resources],
  )

  useEffect(() => {
    void refresh()
    const unsubscribe = subscribePveEvents()
    return unsubscribe
  }, [refresh])

  useEffect(() => {
    void window.pve.app.getVersion().then((res) => {
      if (res.ok && res.data) setAppVersion(res.data)
    })
  }, [])

  useAppShortcuts({
    onAbout: () => setAboutOpen(true),
    onShortcutsHelp: () => setShortcutsOpen(true),
  })

  if (pathname.startsWith('/console/session')) {
    return (
      <Layout style={{ height: '100vh', background: PVE_COLORS.bgBase }}>
        <Outlet />
      </Layout>
    )
  }

  return (
    <Layout style={{ height: '100vh', background: PVE_COLORS.bgBase }}>
      <Header
        className="tech-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingInline: 16,
          height: 56,
          lineHeight: '56px',
        }}
      >
        <Flex align="center" gap={10} style={{ flexShrink: 0 }}>
          <img src={appIcon} alt="" className="app-brand-mark" />
          <div style={{ lineHeight: 1.15 }}>
            <Typography.Text strong style={{ fontSize: 15, display: 'block', color: '#fff' }}>
              {t('app.name')}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 10, letterSpacing: 1.2, color: PVE_COLORS.info }}>
              {t('app.tagline')}
            </Typography.Text>
          </div>
        </Flex>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
          {connected && activeId ? <GlobalSearch connectionId={activeId} /> : null}
        </div>

        <Flex align="center" gap={10} wrap style={{ flexShrink: 0 }}>
          {connected && activeId ? <ClusterHealthChips connectionId={activeId} /> : null}
          {connected ? (
            <Space size={6}>
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                disabled={nodeNames.length === 0}
                onClick={() => {
                  setVmWizardKey((k) => k + 1)
                  setCreateVmOpen(true)
                }}
              >
                {t('nav.createVm')}
              </Button>
              <Button
                size="small"
                icon={<PlusOutlined />}
                disabled={nodeNames.length === 0}
                onClick={() => {
                  setCtWizardKey((k) => k + 1)
                  setCreateCtOpen(true)
                }}
              >
                {t('nav.createCt')}
              </Button>
            </Space>
          ) : null}
          <Button
            type="text"
            size="small"
            icon={<BellOutlined style={{ color: PVE_COLORS.primary }} />}
            onClick={() => void navigate({ to: '/cluster-log' })}
            aria-label={t('nav.clusterLog')}
          />
          <ConnectionSwitcher />
          <Button
            type="text"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => void navigate({ to: '/settings' })}
            aria-label={t('nav.settings')}
          />
        </Flex>
      </Header>

      <Layout>
        <Sider
          width={248}
          theme="dark"
          style={{
            borderRight: `1px solid ${PVE_COLORS.cyanBorder}`,
            display: 'flex',
            flexDirection: 'column',
            background: token.colorBgContainer,
          }}
        >
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[pathname]}
            style={{ borderInlineEnd: 0, flex: 'none', background: 'transparent' }}
            items={[
              {
                key: '/',
                icon: <DashboardOutlined />,
                label: <Link to="/">{t('nav.dashboard')}</Link>,
              },
              {
                key: '/connections',
                icon: <ApiOutlined />,
                label: <Link to="/connections">{t('nav.connections')}</Link>,
              },
              {
                key: '/console',
                icon: <CodeOutlined />,
                label: <Link to="/console">{t('nav.console')}</Link>,
              },
              {
                key: '/cluster-log',
                icon: <FileSearchOutlined />,
                label: <Link to="/cluster-log">{t('nav.clusterLog')}</Link>,
              },
              {
                key: '/cluster',
                icon: <ClusterOutlined />,
                label: <Link to="/cluster">{t('nav.cluster')}</Link>,
              },
              {
                key: '/access',
                icon: <TeamOutlined />,
                label: <Link to="/access">{t('nav.access')}</Link>,
              },
              {
                key: '/firewall',
                icon: <FireOutlined />,
                label: <Link to="/firewall">{t('nav.firewall')}</Link>,
              },
              {
                key: '/datacenter',
                icon: <ApartmentOutlined />,
                label: <Link to="/datacenter">{t('nav.datacenter')}</Link>,
              },
              {
                key: '/settings',
                icon: <SettingOutlined />,
                label: <Link to="/settings">{t('nav.settings')}</Link>,
              },
            ]}
          />

          {connected && activeId && (
            <>
              <Divider style={{ margin: '4px 0', borderColor: token.colorBorderSecondary }} />
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <ResourceTree connectionId={activeId} />
              </div>
            </>
          )}
        </Sider>

        <Layout style={{ background: PVE_COLORS.bgBase }}>
          <Content style={{ padding: 16, overflow: 'auto' }}>
            <Outlet />
          </Content>

          <Footer
            style={{
              padding: 0,
              background: token.colorBgElevated,
              borderTop: `1px solid ${PVE_COLORS.cyanBorder}`,
            }}
          >
            <TaskDock />
          </Footer>
        </Layout>
      </Layout>

      <GuestDrawer />
      <StorageDrawer />
      <NodeDrawer />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} version={appVersion} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {activeId ? (
        <>
          <CreateVmWizard
            key={vmWizardKey}
            open={createVmOpen}
            connectionId={activeId}
            nodes={nodeNames}
            onClose={() => setCreateVmOpen(false)}
          />
          <CreateCtWizard
            key={ctWizardKey}
            open={createCtOpen}
            connectionId={activeId}
            nodes={nodeNames}
            onClose={() => setCreateCtOpen(false)}
          />
        </>
      ) : null}
    </Layout>
  )
}
