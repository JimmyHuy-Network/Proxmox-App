import { useCallback, useEffect, useState } from 'react'
import { App, Badge, Button, Card, Empty, Flex, List, Popconfirm, Space, Tag, Typography } from 'antd'
import {
  ApiOutlined,
  DisconnectOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { CertInfo, ConnectionPhase, ConnectionSummary } from '@pve/ipc'
import { useConnections } from '../../stores/connections'
import { ConnectionForm } from './ConnectionForm'
import { CertTrustModal } from './CertTrustModal'
import { TfaModal } from './TfaModal'

type EstablishReply =
  | { status: 'ok' }
  | { status: 'cert-untrusted'; cert: CertInfo }
  | { status: 'tfa-challenge'; challenge: string }
  | { status: 'failed'; message: string }

const PHASE_BADGE: Record<ConnectionPhase, 'success' | 'processing' | 'error' | 'default' | 'warning'> = {
  idle: 'default',
  connecting: 'processing',
  'cert-challenge': 'warning',
  'tfa-challenge': 'warning',
  authenticated: 'success',
  renewing: 'processing',
  degraded: 'warning',
  failed: 'error',
}

export function ConnectionsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { connections, phases, activeId, refresh, setActive } = useConnections()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ConnectionSummary | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [certPending, setCertPending] = useState<{ id: string; cert: CertInfo } | null>(null)
  const [tfaPending, setTfaPending] = useState<{ id: string } | null>(null)
  const [tfaError, setTfaError] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleResult = useCallback(
    (id: string, result: EstablishReply): void => {
      switch (result.status) {
        case 'ok':
          setActive(id)
          void refresh()
          message.success(t('connections.status.authenticated'))
          break
        case 'cert-untrusted':
          setCertPending({ id, cert: result.cert })
          break
        case 'tfa-challenge':
          setTfaPending({ id })
          setTfaError(null)
          break
        case 'failed':
          message.error(result.message)
          break
      }
    },
    [refresh, setActive, message, t],
  )

  const connect = useCallback(
    async (id: string): Promise<void> => {
      setBusyId(id)
      try {
        const res = await window.pve.vault.connect(id)
        if (res.ok) handleResult(id, res.data as EstablishReply)
        else message.error(res.message)
      } finally {
        setBusyId(null)
      }
    },
    [handleResult, message],
  )

  const trustCert = useCallback(async (): Promise<void> => {
    if (!certPending) return
    const { id, cert } = certPending
    setBusyId(id)
    try {
      const res = await window.pve.vault.trustCert(id, cert.fingerprint256)
      setCertPending(null)
      if (res.ok) handleResult(id, res.data as EstablishReply)
      else message.error(res.message)
    } finally {
      setBusyId(null)
    }
  }, [certPending, handleResult, message])

  const submitTfa = useCallback(
    async (code: string): Promise<void> => {
      if (!tfaPending) return
      const { id } = tfaPending
      setBusyId(id)
      try {
        const res = await window.pve.vault.completeTfa(id, code)
        if (res.ok && (res.data as EstablishReply).status === 'ok') {
          setTfaPending(null)
          handleResult(id, res.data as EstablishReply)
        } else {
          setTfaError(t('tfa.invalid'))
        }
      } finally {
        setBusyId(null)
      }
    },
    [tfaPending, handleResult, t],
  )

  const disconnect = useCallback(
    async (id: string): Promise<void> => {
      await window.pve.vault.disconnect(id)
      useConnections.getState().setPhase(id, 'idle')
    },
    [],
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await window.pve.vault.remove(id)
      void refresh()
    },
    [refresh],
  )

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between">
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('connections.title')}
        </Typography.Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          {t('connections.add')}
        </Button>
      </Flex>

      <Card>
        {connections.length === 0 ? (
          <Empty
            description={
              <Flex vertical gap={4} align="center">
                <Typography.Text strong>{t('connections.empty')}</Typography.Text>
                <Typography.Text type="secondary">{t('connections.emptyHint')}</Typography.Text>
              </Flex>
            }
          />
        ) : (
          <List
            dataSource={connections}
            renderItem={(conn) => {
              const phase = phases[conn.id] ?? 'idle'
              const isActive = conn.id === activeId && phase === 'authenticated'
              return (
                <List.Item
                  actions={[
                    phase === 'authenticated' ? (
                      <Button
                        key="disc"
                        size="small"
                        icon={<DisconnectOutlined />}
                        onClick={() => void disconnect(conn.id)}
                      >
                        {t('connections.disconnect')}
                      </Button>
                    ) : (
                      <Button
                        key="conn"
                        size="small"
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        loading={busyId === conn.id}
                        onClick={() => void connect(conn.id)}
                      >
                        {t('connections.connect')}
                      </Button>
                    ),
                    <Button
                      key="edit"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditing(conn)
                        setFormOpen(true)
                      }}
                    />,
                    <Popconfirm
                      key="del"
                      title={t('connections.removeConfirm')}
                      onConfirm={() => void remove(conn.id)}
                      okText={t('connections.remove')}
                      cancelText={t('common.cancel')}
                    >
                      <Button size="small" danger icon={<DisconnectOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<ApiOutlined style={{ fontSize: 20, marginTop: 4 }} />}
                    title={
                      <Space>
                        {conn.name}
                        {isActive && <Tag color="green">●</Tag>}
                      </Space>
                    }
                    description={
                      <Space split="·" size={4}>
                        <span>
                          {conn.host}:{conn.port}
                        </span>
                        <span>{conn.username}</span>
                        <Tag>{conn.authMode === 'token' ? 'API Token' : 'Ticket'}</Tag>
                        <Badge status={PHASE_BADGE[phase]} text={t(`connections.status.${phase}`)} />
                      </Space>
                    }
                  />
                </List.Item>
              )
            }}
          />
        )}
      </Card>

      <ConnectionForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => void refresh()}
      />

      <CertTrustModal
        cert={certPending?.cert ?? null}
        open={certPending !== null}
        loading={busyId !== null}
        onTrust={() => void trustCert()}
        onCancel={() => setCertPending(null)}
      />

      <TfaModal
        open={tfaPending !== null}
        error={tfaError}
        loading={busyId !== null}
        onSubmit={(code) => void submitTfa(code)}
        onCancel={() => {
          setTfaPending(null)
          setTfaError(null)
        }}
      />
    </Flex>
  )
}
