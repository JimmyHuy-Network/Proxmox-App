import { Button, Dropdown, message } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { ConsoleOpenRequest } from '@pve/ipc'

export function NodeShellButton({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()

  const open = async (kind: 'term' | 'vnc', detach: boolean): Promise<void> => {
    const request: ConsoleOpenRequest = { connectionId, kind, node }
    const reply = await window.pve.console.open(request, { detach })
    if (!reply.ok) message.error(reply.message)
    else if (detach) message.success(t('console.detachedOpened'))
  }

  return (
    <Dropdown
      menu={{
        items: [
          {
            key: 'term',
            label: t('console.nodeShellTerm'),
            onClick: () => void open('term', true),
          },
          {
            key: 'vnc',
            label: t('console.nodeShellVnc'),
            onClick: () => void open('vnc', true),
          },
        ],
      }}
    >
      <Button size="small" type="text" icon={<CodeOutlined />} title={t('console.nodeShell')}>
        {t('console.shell')}
      </Button>
    </Dropdown>
  )
}
