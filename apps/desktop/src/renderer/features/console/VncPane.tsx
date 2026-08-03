import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Flex, Slider, Space, Tag, Tooltip, Typography } from 'antd'
import {
  ExpandOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  SnippetsOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import RFB from '@novnc/novnc'
import type { ConsoleOpenRequest } from '@pve/ipc'

type Status = 'connecting' | 'connected' | 'disconnected' | 'failed'

export interface VncPaneProps {
  request?: ConsoleOpenRequest
  relayUrl?: string
  title?: string
  onDetach?: () => void
}

/**
 * noVNC gắn vào WebSocket relay đã sống — `new RFB(target, ws)` không tự dựng URL,
 * nên không cần cookie/Referer/cert ở renderer (xem relay-server.ts).
 */
export function VncPane({
  request,
  relayUrl: presetRelayUrl,
  title,
  onDetach,
}: VncPaneProps): React.JSX.Element {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [message, setMessage] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState(title ?? '')
  const [generation, setGeneration] = useState(0)
  const [quality, setQuality] = useState(6)

  // Phụ thuộc primitive — tránh remount khi parent tạo `request` mới mỗi render.
  const connectionId = request?.connectionId
  const kind = request?.kind
  const node = request?.node
  const vmid = request?.vmid
  const vmtype = request?.vmtype

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let rfb: RFB | null = null
    let socket: WebSocket | null = null

    void (async () => {
      let url = presetRelayUrl
      if (!url) {
        if (!connectionId || !kind || !node) {
          setStatus('failed')
          setMessage('Thiếu request hoặc relayUrl')
          return
        }
        const reply = await window.pve.console.open({
          connectionId,
          kind,
          node,
          vmid,
          vmtype,
        })
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

      // RFB nhận WebSocket đang sống — không bao giờ tự connect.
      rfb = new RFB(host, socket, {
        wsProtocols: ['binary'],
      })
      rfbRef.current = rfb
      rfb.scaleViewport = true
      rfb.resizeSession = true
      rfb.background = '#0b0d10'
      rfb.qualityLevel = quality
      rfb.compressionLevel = Math.max(0, 9 - quality)

      rfb.addEventListener('connect', () => {
        if (cancelled) return
        setStatus('connected')
        setMessage(null)
      })
      rfb.addEventListener('disconnect', ((ev: CustomEvent<{ clean: boolean }>) => {
        if (cancelled) return
        setStatus(ev.detail.clean ? 'disconnected' : 'failed')
      }) as EventListener)
      rfb.addEventListener('securityfailure', () => {
        if (cancelled) return
        setStatus('failed')
        setMessage('Xác thực VNC thất bại')
      })
      // Guest → host clipboard (khi server hỗ trợ Extended Clipboard).
      rfb.addEventListener('clipboard', ((ev: CustomEvent<{ text: string }>) => {
        const text = ev.detail?.text
        if (typeof text === 'string' && text.length > 0 && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).catch(() => {
            // Môi trường headless / quyền clipboard — bỏ qua im lặng.
          })
        }
      }) as EventListener)
    })()

    return () => {
      cancelled = true
      try {
        rfb?.disconnect()
      } catch {
        // ignore
      }
      rfbRef.current = null
      socket?.close()
      socketRef.current = null
      host.replaceChildren()
    }
    // quality chỉ áp lúc tạo session / khi user kéo slider (effect riêng).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, presetRelayUrl, connectionId, kind, node, vmid, vmtype])

  useEffect(() => {
    const rfb = rfbRef.current
    if (!rfb) return
    rfb.qualityLevel = quality
    rfb.compressionLevel = Math.max(0, 9 - quality)
  }, [quality])

  const reconnect = useCallback(() => {
    socketRef.current?.close()
    setStatus('connecting')
    setMessage(null)
    setGeneration((n) => n + 1)
  }, [])

  const sendCad = useCallback(() => {
    rfbRef.current?.sendCtrlAltDel()
  }, [])

  const pasteClipboard = useCallback(() => {
    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (!text) {
          setMessage(t('console.clipboardEmpty'))
          return
        }
        rfbRef.current?.clipboardPasteFrom(text)
        setMessage(null)
      } catch {
        setMessage(t('console.clipboardDenied'))
      }
    })()
  }, [t])

  const toggleFullscreen = useCallback(() => {
    const el = hostRef.current?.parentElement
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }, [])

  return (
    <Flex vertical gap={12} style={{ height: '100%' }}>
      <Flex align="center" justify="space-between" wrap gap={8}>
        <Space size={8}>
          <Typography.Text strong>{sessionTitle || t('console.title')}</Typography.Text>
          <Tag color="blue">VNC</Tag>
          <StatusTag status={status} />
        </Space>
        <Space size={8} wrap>
          <Tooltip title={t('console.quality')}>
            <Flex align="center" gap={8} style={{ minWidth: 140 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {t('console.quality')}
              </Typography.Text>
              <Slider
                min={0}
                max={9}
                step={1}
                value={quality}
                onChange={setQuality}
                style={{ width: 80, margin: 0 }}
                disabled={status !== 'connected'}
                tooltip={{ formatter: (v) => String(v ?? 0) }}
              />
            </Flex>
          </Tooltip>
          <Button
            size="small"
            icon={<SnippetsOutlined />}
            onClick={pasteClipboard}
            disabled={status !== 'connected'}
          >
            {t('console.clipboardPaste')}
          </Button>
          <Button size="small" icon={<WarningOutlined />} onClick={sendCad} disabled={status !== 'connected'}>
            {t('console.ctrlAltDel')}
          </Button>
          <Button size="small" icon={<FullscreenOutlined />} onClick={toggleFullscreen}>
            {t('console.fullscreen')}
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

      {message !== null && <Alert type="warning" showIcon message={message} />}

      <div
        ref={hostRef}
        style={{
          flex: 1,
          minHeight: 280,
          background: '#0b0d10',
          borderRadius: 6,
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
