import { Card } from 'antd'
import { DEMO_CONNECTION_ID, type ConsoleOpenRequest } from '@pve/ipc'
import { TerminalPane } from '../features/console/TerminalPane'
import { useConnections } from '../stores/connections'

const DEMO_REQUEST: ConsoleOpenRequest = {
  connectionId: DEMO_CONNECTION_ID,
  kind: 'term',
  node: 'pve1',
}

/**
 * Trang Console toàn cục: nếu có kết nối đang authenticated thì mở shell node
 * đầu tiên; không thì giữ demo shell nội bộ (không cần mock).
 */
export function ConsolePage(): React.JSX.Element {
  const activeId = useConnections((s) => s.activeId)
  const phase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && phase === 'authenticated'

  const request: ConsoleOpenRequest = connected
    ? { connectionId: activeId, kind: 'term', node: 'pve1' }
    : DEMO_REQUEST

  return (
    <Card styles={{ body: { height: 'calc(100vh - 200px)' } }}>
      <TerminalPane
        request={request}
        showDemoBadge={!connected}
        onDetach={() => {
          void window.pve.console.open(request, { detach: true })
        }}
      />
    </Card>
  )
}
