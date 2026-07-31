import { Button, Card, Empty, Flex, Typography } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export function Dashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('dashboard.title')}
      </Typography.Title>

      <Card>
        <Empty
          description={
            <Flex vertical gap={8} align="center">
              <Typography.Text strong>{t('dashboard.noConnection')}</Typography.Text>
              <Typography.Text type="secondary" style={{ maxWidth: 520 }}>
                {t('dashboard.noConnectionHint')}
              </Typography.Text>
            </Flex>
          }
        >
          <Button
            type="primary"
            icon={<CodeOutlined />}
            onClick={() => void navigate({ to: '/console' })}
          >
            {t('dashboard.openConsole')}
          </Button>
        </Empty>
      </Card>
    </Flex>
  )
}
