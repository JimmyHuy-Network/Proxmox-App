import { useEffect, useState } from 'react'
import { Badge, Dropdown, Layout, Menu, Space, Typography, theme } from 'antd'
import {
  ApiOutlined,
  CodeOutlined,
  DashboardOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ConnectionPhase } from '@pve/ipc'
import { subscribeConnectionEvents, useConnections } from '../stores/connections'

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
  const [dockOpen, setDockOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const refresh = useConnections((s) => s.refresh)

  // Nạp danh sách kết nối và lắng nghe sự kiện đổi pha xác thực từ main.
  useEffect(() => {
    void refresh()
    const unsubscribe = subscribeConnectionEvents()
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
          style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
        >
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[pathname]}
            style={{ height: '100%', borderInlineEnd: 0 }}
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
            <button
              type="button"
              onClick={() => setDockOpen((open) => !open)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 16px',
                background: 'transparent',
                border: 'none',
                color: token.colorTextSecondary,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12,
              }}
            >
              {dockOpen ? <DownOutlined /> : <UpOutlined />}
              {t('tasks.dockTitle')}
            </button>

            {dockOpen && (
              <div style={{ padding: '8px 16px 12px', height: 140, overflow: 'auto' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('tasks.empty')}
                </Typography.Text>
              </div>
            )}
          </Footer>
        </Layout>
      </Layout>
    </Layout>
  )
}
