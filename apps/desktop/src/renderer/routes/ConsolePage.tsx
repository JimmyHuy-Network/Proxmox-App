import { Card } from 'antd'
import { TerminalPane } from '../features/console/TerminalPane'

export function ConsolePage(): React.JSX.Element {
  return (
    <Card styles={{ body: { height: 'calc(100vh - 200px)' } }}>
      <TerminalPane />
    </Card>
  )
}
