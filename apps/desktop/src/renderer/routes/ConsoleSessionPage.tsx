import { Card, Result } from 'antd'
import { useRouterState } from '@tanstack/react-router'
import type { ConsoleKind } from '@pve/ipc'
import { TerminalPane } from '../features/console/TerminalPane'
import { VncPane } from '../features/console/VncPane'

/**
 * Cửa sổ console tách — nhận session đã mở qua hash query, nối thẳng relayUrl.
 * Không gọi console.open lại (token dùng một lần đã được tiêu thụ bởi URL này).
 */
export function ConsoleSessionPage(): React.JSX.Element {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)

  const relayUrl = params.get('relayUrl') ?? ''
  const kind = (params.get('kind') ?? 'term') as ConsoleKind
  const title = params.get('title') ?? 'Console'

  if (!relayUrl.startsWith('ws://127.0.0.1:')) {
    return <Result status="error" title="Phiên console không hợp lệ" />
  }

  return (
    <Card
      size="small"
      title={title}
      styles={{ body: { height: 'calc(100vh - 80px)', padding: 12 } }}
      style={{ height: '100vh', borderRadius: 0 }}
    >
      {kind === 'vnc' ? (
        <VncPane relayUrl={relayUrl} title={title} />
      ) : (
        <TerminalPane relayUrl={relayUrl} title={title} />
      )}
    </Card>
  )
}
