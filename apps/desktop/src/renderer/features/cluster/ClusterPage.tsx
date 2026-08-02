import { App, Form, Input, Space, Typography } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { PveForm } from '../../components/PveForm'
import { TaskButton } from '../../components/TaskButton'
import { useConnections } from '../../stores/connections'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface ClusterNodeRow {
  [key: string]: unknown
  node: string
  nodeid?: number
  ring0_addr?: string
  quorum_votes?: number
}

interface JoinInfo {
  preferred_node?: string
  config_digest?: string
  nodelist?: { name: string; pve_addr?: string; pve_fp?: string }[]
  totem?: { cluster_name?: string }
}

/**
 * Trang cluster: danh sách node corosync, tạo cluster / join.
 */
export function ClusterPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const activeId = useConnections((s) => s.activeId)
  const phase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && phase === 'authenticated'
  const queryClient = useQueryClient()
  const [createForm] = Form.useForm<{ clustername: string }>()
  const [joinForm] = Form.useForm<{ hostname: string; password: string; fingerprint: string }>()

  const joinQuery = useQuery({
    queryKey: connected
      ? pveQueryKey(activeId!, 'GET', '/cluster/config/join', {})
      : ['cluster-join', 'idle'],
    queryFn: () => pveRequest<JoinInfo>(activeId!, 'GET', '/cluster/config/join', {}),
    enabled: connected,
  })

  if (!connected || !activeId) {
    return <div>{t('dashboard.noConnection')}</div>
  }

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['pve', activeId] })
  }

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('nav.cluster')}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        {t('cluster.hint')} — {joinQuery.data?.totem?.cluster_name ?? '…'}
      </Typography.Paragraph>

      <PveGrid<ClusterNodeRow>
        connectionId={activeId}
        method="GET"
        path="/cluster/config/nodes"
        params={{}}
        rowKey="node"
        emptyText={t('cluster.nodesEmpty')}
        columns={[
          { title: 'Node', dataIndex: 'node', width: 120 },
          { title: 'ID', dataIndex: 'nodeid', width: 70 },
          { title: 'Ring0', dataIndex: 'ring0_addr', width: 140 },
          { title: 'Votes', dataIndex: 'quorum_votes', width: 80 },
        ]}
      />

      <Space align="start" size={32} wrap style={{ width: '100%' }}>
        <div style={{ minWidth: 280, flex: 1 }}>
          <Typography.Title level={5}>{t('cluster.create')}</Typography.Title>
          <PveForm
            form={createForm}
            submitText={t('cluster.create')}
            initialValues={{ clustername: 'pve-lab' }}
            onFinish={async (values) => {
              const upid = await pveRequest<string>(activeId, 'POST', '/cluster/config', {
                clustername: values.clustername,
              })
              message.success(`${t('cluster.createStarted')}: ${upid}`)
              invalidate()
            }}
          >
            <Form.Item name="clustername" label={t('cluster.name')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </PveForm>
        </div>

        <div style={{ minWidth: 320, flex: 1 }}>
          <Typography.Title level={5}>{t('cluster.join')}</Typography.Title>
          <PveForm
            form={joinForm}
            submitText={t('cluster.join')}
            initialValues={{
              hostname: joinQuery.data?.preferred_node ?? 'pve1',
              fingerprint: joinQuery.data?.nodelist?.[0]?.pve_fp ?? '',
            }}
            onFinish={async (values) => {
              const upid = await pveRequest<string>(activeId, 'POST', '/cluster/config/join', {
                hostname: values.hostname,
                password: values.password,
                fingerprint: values.fingerprint,
              })
              message.success(`${t('cluster.joinStarted')}: ${upid}`)
              invalidate()
            }}
          >
            <Form.Item name="hostname" label="Hostname" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="password" label={t('connections.password')} rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="fingerprint" label="Fingerprint" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </PveForm>
          {joinQuery.data?.preferred_node && (
            <Space style={{ marginTop: 8 }}>
              <TaskButton
                connectionId={activeId}
                method="POST"
                path="/cluster/config/join"
                params={{
                  hostname: joinQuery.data.preferred_node,
                  password: 'x',
                  fingerprint: joinQuery.data.nodelist?.[0]?.pve_fp ?? 'AA:BB',
                }}
                label={t('cluster.quickJoin')}
                size="small"
                onDone={invalidate}
              />
            </Space>
          )}
        </div>
      </Space>
    </Space>
  )
}
