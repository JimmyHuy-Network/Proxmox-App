import { useState } from 'react'
import { Layout, Menu, Space, Typography, theme } from 'antd'
import { CodeOutlined, DashboardOutlined, DownOutlined, UpOutlined } from '@ant-design/icons'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

const { Sider, Header, Content, Footer } = Layout

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
