import { useState } from 'react'
import { App, Button, Form, Input, Modal, Space, Tabs, Typography } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { PveForm } from '../../components/PveForm'
import { CapButton } from '../../components/CapButton'
import { TaskButton } from '../../components/TaskButton'
import { useConnections } from '../../stores/connections'
import { usePermissions } from '../../hooks/usePermissions'
import { pveQueryKey, pveRequest } from '../../lib/pve'

type Row = Record<string, unknown>

/** SDN + HA + Replication + Notifications + Metrics — một trang tab (GĐ 8). */
export function DatacenterExtrasPage(): React.JSX.Element {
  const { t } = useTranslation()
  const activeId = useConnections((s) => s.activeId)
  const phase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && phase === 'authenticated'
  const { can } = usePermissions(activeId)

  if (!connected || !activeId) {
    return <div>{t('dashboard.noConnection')}</div>
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="tech-glass-card" style={{ padding: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('nav.datacenter')}
        </Typography.Title>
      </div>
      <div className="tech-glass-card" style={{ padding: 12 }}>
      <Tabs
        items={[
          {
            key: 'sdn',
            label: t('nav.sdn'),
            children: (
              <SdnTab
                connectionId={activeId}
                canModify={can('SDN.Allocate', '/sdn') || can('SDN.Allocate', '/')}
              />
            ),
          },
          {
            key: 'ha',
            label: t('nav.ha'),
            children: <HaTab connectionId={activeId} canModify={can('Sys.Modify', '/')} />,
          },
          {
            key: 'replication',
            label: t('nav.replication'),
            children: (
              <ReplicationTab connectionId={activeId} canModify={can('VM.Allocate', '/')} />
            ),
          },
          {
            key: 'notifications',
            label: t('nav.notifications'),
            children: (
              <NotificationsTab connectionId={activeId} canModify={can('Sys.Modify', '/')} />
            ),
          },
          {
            key: 'metrics',
            label: t('nav.metrics'),
            children: <MetricsTab connectionId={activeId} canModify={can('Sys.Modify', '/')} />,
          },
        ]}
      />
      </div>
    </Space>
  )
}

function SdnTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const zonesKey = pveQueryKey(connectionId, 'GET', '/cluster/sdn/zones', {})
  const node = 'pve1'

  const zonesQ = useQuery({
    queryKey: zonesKey,
    queryFn: () => pveRequest<Row[]>(connectionId, 'GET', '/cluster/sdn/zones', {}),
  })
  const vnetsQ = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/cluster/sdn/vnets', {}),
    queryFn: () => pveRequest<Row[]>(connectionId, 'GET', '/cluster/sdn/vnets', {}),
  })

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space wrap>
        <div className="neon-border" style={{ padding: '8px 14px', borderRadius: 8, minWidth: 120 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {t('sdn.zones')}
          </Typography.Text>
          <div className="tech-mono" style={{ fontSize: 20 }}>
            {zonesQ.data?.length ?? '—'}
          </div>
        </div>
        <div className="neon-border" style={{ padding: '8px 14px', borderRadius: 8, minWidth: 120 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {t('sdn.vnets')}
          </Typography.Text>
          <div className="tech-mono" style={{ fontSize: 20 }}>
            {vnetsQ.data?.length ?? '—'}
          </div>
        </div>
      </Space>
      {(vnetsQ.data?.length ?? 0) > 0 ? (
        <div className="sdn-topo-wrap">
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            Network Topology (zones → vnets)
          </Typography.Text>
          <svg
            width="100%"
            height={Math.max(160, (zonesQ.data?.length ?? 1) * 72 + 40)}
            style={{ marginTop: 10 }}
          >
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle cx="48" cy="28" r="10" fill="rgba(0,242,254,0.25)" stroke="#00f2fe" filter="url(#glow)" />
            <text x="68" y="32" fill="#00f2fe" fontSize={11}>
              Edge
            </text>
            {(zonesQ.data ?? []).map((z, i) => {
              const zone = String(z.zone ?? '')
              const children = (vnetsQ.data ?? []).filter((v) => String(v.zone) === zone)
              const y = 64 + i * 72
              return (
                <g key={zone || i}>
                  <line x1="48" y1="38" x2="48" y2={y} stroke="rgba(0,242,254,0.25)" strokeDasharray="4 3" />
                  <rect
                    x={16}
                    y={y - 18}
                    width={140}
                    height={36}
                    rx={8}
                    fill="rgba(0,242,254,0.12)"
                    stroke="rgba(0,242,254,0.55)"
                    filter="url(#glow)"
                  />
                  <text x={86} y={y + 4} textAnchor="middle" fill="#00f2fe" fontSize={12} fontWeight={600}>
                    {zone}
                  </text>
                  {children.map((v, j) => {
                    const vx = 220 + j * 130
                    return (
                      <g key={String(v.vnet)}>
                        <line x1={156} y1={y} x2={vx} y2={y} stroke="rgba(255,107,0,0.55)" strokeWidth={1.5} />
                        <rect
                          x={vx}
                          y={y - 16}
                          width={110}
                          height={32}
                          rx={8}
                          fill="rgba(255,107,0,0.12)"
                          stroke="rgba(255,107,0,0.5)"
                        />
                        <text x={vx + 55} y={y + 4} textAnchor="middle" fill="#ffb020" fontSize={11}>
                          {String(v.vnet)}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        </div>
      ) : null}
      <Space>
        <TaskButton
          connectionId={connectionId}
          method="PUT"
          path="/cluster/sdn"
          params={{}}
          label={t('sdn.apply')}
          type="primary"
          size="small"
          disabled={!canModify}
        />
        <CapButton
          size="small"
          allowed={canModify}
          denyReason={t('access.denied')}
          onClick={() => setOpen(true)}
        >
          {t('sdn.addZone')}
        </CapButton>
      </Space>
      <Typography.Text strong>{t('sdn.zones')}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/sdn/zones"
        params={{}}
        rowKey="zone"
        emptyText={t('sdn.zonesEmpty')}
        columns={[
          { title: 'zone', dataIndex: 'zone', width: 120 },
          { title: 'type', dataIndex: 'type', width: 100 },
          { title: 'ipam', dataIndex: 'ipam', width: 80 },
          { title: 'state', dataIndex: 'state', width: 100 },
          { title: 'pending', dataIndex: 'pending', width: 80 },
        ]}
      />
      <Typography.Text strong>{t('sdn.vnets')}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/sdn/vnets"
        params={{}}
        rowKey="vnet"
        emptyText={t('sdn.vnetsEmpty')}
        columns={[
          { title: 'vnet', dataIndex: 'vnet', width: 120 },
          { title: 'zone', dataIndex: 'zone', width: 120 },
          { title: 'tag', dataIndex: 'tag', width: 80 },
          { title: 'alias', dataIndex: 'alias' },
        ]}
      />
      <Typography.Text strong>{t('sdn.controllers')}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/sdn/controllers"
        params={{}}
        rowKey="controller"
        emptyText="—"
        columns={[
          { title: 'controller', dataIndex: 'controller', width: 140 },
          { title: 'type', dataIndex: 'type', width: 100 },
          { title: 'asn', dataIndex: 'asn', width: 80 },
        ]}
      />
      <Typography.Text strong>IPAM</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/sdn/ipams"
        params={{}}
        rowKey="ipam"
        emptyText="—"
        columns={[
          { title: 'ipam', dataIndex: 'ipam', width: 120 },
          { title: 'type', dataIndex: 'type' },
        ]}
      />
      <Modal open={open} title={t('sdn.addZone')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ zone: string; type: string }>
          initialValues={{ zone: '', type: 'simple' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/cluster/sdn/zones', v)
            message.success(t('sdn.zoneAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: zonesKey })
            void node
          }}
        >
          <Form.Item name="zone" label="zone" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="type" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </Space>
  )
}

function HaTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const resKey = pveQueryKey(connectionId, 'GET', '/cluster/ha/resources', {})

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Typography.Text strong>{t('ha.status')}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/ha/status/current"
        params={{}}
        rowKey={(r) => String(r.id ?? r.sid)}
        emptyText="—"
        refetchInterval={5000}
        columns={[
          { title: 'id', dataIndex: 'id', width: 140 },
          { title: 'type', dataIndex: 'type', width: 90 },
          { title: 'node', dataIndex: 'node', width: 100 },
          { title: 'status', dataIndex: 'status', width: 90 },
          { title: 'state', dataIndex: 'state', width: 90 },
        ]}
      />
      <Typography.Text strong>{t('ha.groups')}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/ha/groups"
        params={{}}
        rowKey="group"
        emptyText={t('ha.groupsEmpty')}
        columns={[
          { title: 'group', dataIndex: 'group', width: 160 },
          { title: 'nodes', dataIndex: 'nodes' },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
      <Space>
        <Typography.Text strong>{t('ha.resources')}</Typography.Text>
        <CapButton
          size="small"
          type="primary"
          allowed={canModify}
          denyReason={t('access.denied')}
          onClick={() => setOpen(true)}
        >
          {t('ha.addResource')}
        </CapButton>
      </Space>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/ha/resources"
        params={{}}
        rowKey="sid"
        emptyText={t('ha.resourcesEmpty')}
        columns={[
          { title: 'sid', dataIndex: 'sid', width: 140 },
          { title: 'state', dataIndex: 'state', width: 100 },
          { title: 'group', dataIndex: 'group', width: 140 },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
      <Modal open={open} title={t('ha.addResource')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ sid: string; group?: string; state?: string }>
          initialValues={{ sid: 'vm:101', group: 'ha-preferred', state: 'started' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/cluster/ha/resources', v)
            message.success(t('ha.resourceAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: resKey })
          }}
        >
          <Form.Item name="sid" label="sid" rules={[{ required: true }]}>
            <Input placeholder="vm:100" />
          </Form.Item>
          <Form.Item name="group" label="group">
            <Input />
          </Form.Item>
          <Form.Item name="state" label="state">
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </Space>
  )
}

function ReplicationTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/cluster/replication', {})

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/replication"
        params={{}}
        rowKey="id"
        emptyText={t('replication.empty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('replication.add')}
          </CapButton>
        }
        columns={[
          { title: 'id', dataIndex: 'id', width: 90 },
          { title: 'guest', dataIndex: 'guest', width: 80 },
          { title: 'target', dataIndex: 'target', width: 100 },
          { title: 'schedule', dataIndex: 'schedule', width: 90 },
          { title: 'enabled', dataIndex: 'enabled', width: 80 },
          { title: 'last_sync', dataIndex: 'last_sync', width: 120 },
          { title: t('access.comment'), dataIndex: 'comment' },
          {
            title: '',
            key: 'run',
            width: 120,
            render: (_, row) => (
              <TaskButton
                connectionId={connectionId}
                method="POST"
                path="/nodes/{node}/replication/{id}/schedule_now"
                params={{ node: 'pve1', id: row.id }}
                label={t('replication.runNow')}
                size="small"
                disabled={!canModify}
              />
            ),
          },
        ]}
      />
      <Modal open={open} title={t('replication.add')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ guest: number; target: string; schedule?: string }>
          initialValues={{ guest: 100, target: 'pve2', schedule: '*/15' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/cluster/replication', v)
            message.success(t('replication.added'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="guest" label="guest" rules={[{ required: true }]}>
            <Input type="number" />
          </Form.Item>
          <Form.Item name="target" label="target" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="schedule" label="schedule">
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function NotificationsTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Typography.Text strong>{t('notifications.targets')}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/notifications/targets"
        params={{}}
        rowKey="name"
        emptyText={t('notifications.targetsEmpty')}
        columns={[
          { title: 'name', dataIndex: 'name', width: 160 },
          { title: 'type', dataIndex: 'type', width: 100 },
          { title: t('access.comment'), dataIndex: 'comment' },
          {
            title: '',
            key: 'test',
            width: 90,
            render: (_, row) => (
              <CapButton
                size="small"
                allowed={canModify}
                denyReason={t('access.denied')}
                onClick={() => {
                  void pveRequest(connectionId, 'POST', '/cluster/notifications/targets/{name}/test', {
                    name: row.name,
                  })
                }}
              >
                {t('notifications.test')}
              </CapButton>
            ),
          },
        ]}
      />
      <Typography.Text strong>{t('notifications.matchers')}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/notifications/matchers"
        params={{}}
        rowKey="name"
        emptyText="—"
        columns={[
          { title: 'name', dataIndex: 'name', width: 140 },
          { title: 'severity', dataIndex: 'match_severity', width: 100 },
          { title: 'target', dataIndex: 'target', width: 140 },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
    </Space>
  )
}

function MetricsTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/cluster/metrics/server', {})

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/metrics/server"
        params={{}}
        rowKey="id"
        emptyText={t('metrics.empty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('metrics.add')}
          </CapButton>
        }
        columns={[
          { title: 'id', dataIndex: 'id', width: 120 },
          { title: 'type', dataIndex: 'type', width: 100 },
          { title: 'server', dataIndex: 'server' },
          { title: 'port', dataIndex: 'port', width: 80 },
          { title: 'proto', dataIndex: 'proto', width: 80 },
        ]}
      />
      <Modal open={open} title={t('metrics.add')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ id: string; type: string; server: string; port?: number }>
          initialValues={{ id: '', type: 'influxdb', server: '', port: 8089 }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/cluster/metrics/server/{id}', v)
            message.success(t('metrics.added'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="id" label="id" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="type" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="server" label="server" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="port" label="port">
            <Input type="number" />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}
