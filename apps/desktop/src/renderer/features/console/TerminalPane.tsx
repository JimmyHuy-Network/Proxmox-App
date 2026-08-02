import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Flex, Space, Tag, Typography } from 'antd'
import {
  ClearOutlined,
  ExpandOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { ConsoleOpenRequest } from '@pve/ipc'
import '@xterm/xterm/css/xterm.css'
import { attachTerminal } from './term-attach'

type Status = 'connecting' | 'connected' | 'disconnected' | 'failed'

export interface TerminalPaneProps {
  /** Mở phiên mới qua IPC. Bỏ trống nếu đã có `relayUrl` sẵn (cửa sổ tách). */
  request?: ConsoleOpenRequest
  /** Nối thẳng tới relay đã cấp — không gọi console.open lại. */
  relayUrl?: string
  title?: string
  showDemoBadge?: boolean
  onDetach?: () => void
}

export function TerminalPane({
  request,
  relayUrl: presetRelayUrl,
  title,
  showDemoBadge = false,
  onDetach,
}: TerminalPaneProps): React.JSX.Element {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [message, setMessage] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState(title ?? '')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Consolas", "DejaVu Sans Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      convertEol: false,
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
        // Pane ẩn (kích thước 0).
      }
    })
    resizeObserver.observe(host)

    let attach: { dispose(): void } | null = null
    let socket: WebSocket | null = null
    let cancelled = false

    void (async () => {
      let url = presetRelayUrl
      if (!url) {
        if (!request) {
          setStatus('failed')
          setMessage('Thiếu request hoặc relayUrl')
          return
        }
        const reply = await window.pve.console.open(request)
        if (cancelled) return
        if (!reply.ok || !reply.data) {
          setStatus('failed')
          setMessage(reply.ok ? 'Không nhận được phiên console' : reply.message)
          return
        }
        url = reply.data.relayUrl
        setSessionTitle(reply.data.title)
      }

      socket = new WebSocket(url, 'binary')
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
  }, [generation, presetRelayUrl, request])

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
          <Typography.Text strong>{sessionTitle || t('console.title')}</Typography.Text>
          {showDemoBadge && <Tag color="orange">{t('console.demoBadge')}</Tag>}
          <StatusTag status={status} />
        </Space>
        <Space size={8}>
          <Button size="small" icon={<ClearOutlined />} onClick={clear}>
            {t('console.clear')}
          </Button>
          {onDetach && (
            <Button size="small" icon={<ExpandOutlined />} onClick={onDetach}>
              {t('console.detach')}
            </Button>
          )}
          <Button size="small" icon={<ReloadOutlined />} onClick={reconnect}>
            {t('console.reconnect')}
          </Button>
        </Space>
      </Flex>

      {showDemoBadge && <Alert type="info" showIcon message={t('console.hint')} />}
      {message !== null && <Alert type="warning" showIcon message={message} />}

      <div
        ref={hostRef}
        style={{
          flex: 1,
          minHeight: 280,
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
