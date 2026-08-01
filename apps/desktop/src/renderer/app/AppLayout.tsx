import { useEffect } from 'react'
import { Badge, Divider, Dropdown, Layout, Menu, Space, Typography, theme } from 'antd'
import { ApiOutlined, CodeOutlined, DashboardOutlined, DownOutlined } from '@ant-design/icons'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ConnectionPhase } from '@pve/ipc'
import { useConnections } from '../stores/connections'
import { subscribePveEvents } from '../lib/events'
import { ResourceTree } from '../features/resources/ResourceTree'
import { TaskDock } from '../features/tasks/TaskDock'
import { GuestDrawer } from '../features/resources/GuestDrawer'

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

  // Nạp danh sách kết nối và lắng nghe mọi sự kiện đẩy từ main (auth, resources, task).
  useEffect(() => {
    void refresh()
    const unsubscribe = subscribePveEvents()
    return unsubscribe
  }, [refresh])

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
        <div style={{ marginInlineStart: 'auto' }}>
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
    </Layout>
  )
}
