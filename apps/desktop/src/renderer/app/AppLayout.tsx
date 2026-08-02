import { useEffect, useState } from 'react'
import { Badge, Divider, Dropdown, Layout, Menu, Space, Typography, theme } from 'antd'
import {
  ApiOutlined,
  CodeOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DownOutlined,
  FileSearchOutlined,
  TeamOutlined,
  ApartmentOutlined,
  FireOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
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

/** Bộ chọn kết nối trên header — chuyển qua lại giữa các cluster đã cấu hình. */
function ConnectionSwitcher(): React.JSX.Element | null {
  const { connections, activeId, phases, setActive } = useConnections()
  const active = connections.find((c) => c.id === activeId)

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
      <Space style={{ cursor: 'pointer' }}>
        <ApiOutlined />
        {active ? active.name : '—'}
        <Badge status={PHASE_STATUS[(active && phases[active.id]) || 'idle']} />
        <DownOutlined style={{ fontSize: 10 }} />
      </Space>
    </Dropdown>
  )
}

/**
 * Khung giao diện chính, phỏng theo bố cục của Proxmox web UI:
 * cây tài nguyên bên trái, nội dung ở giữa, và dock nhật ký tác vụ ở dưới.
 *
 * Ở giai đoạn 3 phần Sider sẽ được thay bằng cây tài nguyên thật lấy từ
 * `/cluster/resources`, còn Footer thành dock tác vụ có log chạy trực tiếp.
 */
export function AppLayout(): React.JSX.Element {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const refresh = useConnections((s) => s.refresh)
  const activeId = useConnections((s) => s.activeId)
  const activePhase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && activePhase === 'authenticated'
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [appVersion, setAppVersion] = useState<{ app?: string; electron?: string } | null>(null)

  // Nạp danh sách kết nối và lắng nghe mọi sự kiện đẩy từ main (auth, resources, task).
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

  // Cửa sổ console tách — chỉ cần nội dung, không sider/header/dock.
  if (pathname.startsWith('/console/session')) {
    return (
      <Layout style={{ height: '100vh', background: '#0b0d10' }}>
        <Outlet />
      </Layout>
    )
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingInline: 16,
          background: token.colorBgElevated,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Space size={8}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {t('app.name')}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('app.tagline')}
          </Typography.Text>
        </Space>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
          {connected ? <GlobalSearch connectionId={activeId} /> : null}
        </div>
        <div>
          <ConnectionSwitcher />
        </div>
      </Header>

      <Layout>
        <Sider
          width={240}
          theme="dark"
          style={{
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[pathname]}
            style={{ borderInlineEnd: 0, flex: 'none' }}
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
              <div style={{ flex: 1, minHeight: 0 }}>
                <ResourceTree connectionId={activeId} />
              </div>
            </>
          )}
        </Sider>

        <Layout>
          <Content style={{ padding: 16, overflow: 'auto' }}>
            <Outlet />
          </Content>

          <Footer
            style={{
              padding: 0,
              background: token.colorBgElevated,
              borderTop: `1px solid ${token.colorBorderSecondary}`,
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
    </Layout>
  )
}
