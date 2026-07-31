import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Flex, Space, Tag, Typography } from 'antd'
import { ClearOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { DEMO_CONNECTION_ID, type ConsoleOpenRequest } from '@pve/ipc'
import '@xterm/xterm/css/xterm.css'
import { attachTerminal } from './term-attach'

type Status = 'connecting' | 'connected' | 'disconnected' | 'failed'

const DEMO_REQUEST: ConsoleOpenRequest = {
  connectionId: DEMO_CONNECTION_ID,
  kind: 'term',
  node: 'pve1',
}

export function TerminalPane(): React.JSX.Element {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [message, setMessage] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Consolas", "DejaVu Sans Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      convertEol: false,
      // Cần cho việc tính độ rộng ô của emoji và chữ Đông Á cho đúng.
      allowProposedApi: true,
      theme: {
        background: '#0b0d10',
        foreground: '#d6deeb',
        cursor: '#7fdbca',
        selectionBackground: '#1d3b53',
      },
    })

    const fit = new FitAddon()
    term.loadAddon(fit)

    const unicode = new Unicode11Addon()
    term.loadAddon(unicode)
    term.unicode.activeVersion = '11'

    term.open(host)
    fit.fit()
    termRef.current = term

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // Xảy ra khi pane bị ẩn (kích thước 0). Bỏ qua an toàn.
      }
    })
    resizeObserver.observe(host)

    let attach: { dispose(): void } | null = null
    let socket: WebSocket | null = null
    let cancelled = false

    void (async () => {
      const reply = await window.pve.console.open(DEMO_REQUEST)
      if (cancelled) return

      if (!reply.ok || !reply.data) {
        const detail = reply.ok ? 'Không nhận được phiên console' : reply.message
        setStatus('failed')
        setMessage(detail)
        return
      }

      socket = new WebSocket(reply.data.relayUrl, 'binary')
      socketRef.current = socket

      socket.addEventListener('open', () => {
        if (cancelled) return
        setStatus('connected')
        setMessage(null)
        term.focus()
      })

      socket.addEventListener('close', (event) => {
        if (cancelled) return
        setStatus('disconnected')
        if (event.code >= 4000) setMessage(event.reason || `Mã đóng ${event.code}`)
      })

      socket.addEventListener('error', () => {
        if (cancelled) return
        setStatus('failed')
        setMessage('Không mở được kết nối tới relay console')
      })

      attach = attachTerminal(term, socket)
    })()

    return () => {
      cancelled = true
      attach?.dispose()
      resizeObserver.disconnect()
      socket?.close()
      socketRef.current = null
      term.dispose()
      termRef.current = null
    }
  }, [generation])

  const reconnect = useCallback(() => {
    socketRef.current?.close()
    setStatus('connecting')
    setMessage(null)
    setGeneration((n) => n + 1)
  }, [])

  const clear = useCallback(() => {
    termRef.current?.clear()
    termRef.current?.focus()
  }, [])

  return (
    <Flex vertical gap={12} style={{ height: '100%' }}>
      <Flex align="center" justify="space-between" wrap gap={8}>
        <Space size={8}>
          <Typography.Text strong>{t('console.title')}</Typography.Text>
          <Tag color="orange">{t('console.demoBadge')}</Tag>
          <StatusTag status={status} />
        </Space>
        <Space size={8}>
          <Button size="small" icon={<ClearOutlined />} onClick={clear}>
            {t('console.clear')}
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={reconnect}>
            {t('console.reconnect')}
          </Button>
        </Space>
      </Flex>

      <Alert type="info" showIcon message={t('console.hint')} />

      {message !== null && <Alert type="warning" showIcon message={message} />}

      <div
        ref={hostRef}
        style={{
          flex: 1,
          minHeight: 320,
          background: '#0b0d10',
          borderRadius: 6,
          padding: 8,
          overflow: 'hidden',
        }}
      />
    </Flex>
  )
}

function StatusTag({ status }: { status: Status }): React.JSX.Element {
  const { t } = useTranslation()
  const map = {
    connecting: { color: 'processing', label: t('console.connecting') },
    connected: { color: 'success', label: t('console.connected') },
    disconnected: { color: 'default', label: t('console.disconnected') },
    failed: { color: 'error', label: t('console.failed') },
  } as const

  const { color, label } = map[status]
  return <Tag color={color}>{label}</Tag>
}
