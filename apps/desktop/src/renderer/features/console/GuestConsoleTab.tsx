import { useState } from 'react'
import { Alert, Button, Flex, Radio, Space, message } from 'antd'
import { DesktopOutlined, CodeOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { ConsoleKind, ConsoleOpenRequest } from '@pve/ipc'
import { TerminalPane } from './TerminalPane'
import { VncPane } from './VncPane'

export interface GuestConsoleTabProps {
  connectionId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number
}

/**
 * Tab Console trong GuestDrawer — chọn VNC / Terminal / SPICE, mở trong tab
 * hoặc cửa sổ tách.
 */
export function GuestConsoleTab({
  connectionId,
  node,
  type,
  vmid,
}: GuestConsoleTabProps): React.JSX.Element {
  const { t } = useTranslation()
  const [kind, setKind] = useState<ConsoleKind>(type === 'lxc' ? 'term' : 'vnc')
  const [generation, setGeneration] = useState(0)

  const request: ConsoleOpenRequest = {
    connectionId,
    kind,
    node,
    vmid,
    vmtype: type,
  }

  const detach = async (): Promise<void> => {
    if (kind === 'spice') return
    const reply = await window.pve.console.open(
      { connectionId, kind, node, vmid, vmtype: type },
      { detach: true },
    )
    if (!reply.ok) message.error(reply.message)
    else message.success(t('console.detachedOpened'))
  }

  const openSpice = async (): Promise<void> => {
    const reply = await window.pve.console.openSpice({
      connectionId,
      kind: 'spice',
      node,
      vmid,
      vmtype: type,
    })
    if (!reply.ok) message.error(reply.message)
    else message.success(t('console.spiceOpened'))
  }

  return (
    <Flex vertical gap={12} style={{ minHeight: 360 }}>
      <Space wrap>
        <Radio.Group
          value={kind === 'spice' ? 'vnc' : kind}
          onChange={(e) => {
            setKind(e.target.value as ConsoleKind)
            setGeneration((n) => n + 1)
          }}
          optionType="button"
          buttonStyle="solid"
          size="small"
          options={[
            { value: 'vnc', label: <Space size={4}><DesktopOutlined />VNC</Space> },
            { value: 'term', label: <Space size={4}><CodeOutlined />{t('console.terminal')}</Space> },
          ]}
        />
        <Button size="small" onClick={() => void openSpice()}>
          {t('console.spice')}
        </Button>
      </Space>

      <Alert type="info" showIcon message={t('console.guestHint')} />

      {kind === 'term' ? (
        <div style={{ height: 420 }} key={`term-${generation}`}>
          <TerminalPane request={request} onDetach={() => void detach()} />
        </div>
      ) : (
        <div style={{ height: 420 }} key={`vnc-${generation}`}>
          <VncPane request={{ ...request, kind: 'vnc' }} onDetach={() => void detach()} />
        </div>
      )}
    </Flex>
  )
}
