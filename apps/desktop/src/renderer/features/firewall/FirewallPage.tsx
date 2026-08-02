import { useState } from 'react'
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Tabs, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { PveForm } from '../../components/PveForm'
import { CapButton } from '../../components/CapButton'
import { useConnections } from '../../stores/connections'
import { usePermissions } from '../../hooks/usePermissions'
import { pveQueryKey, pveRequest } from '../../lib/pve'

type Row = Record<string, unknown>

/**
 * Firewall cụm (GĐ 8): rules + aliases + IPSet + security groups + options.
 * Kéo thả sắp xếp = nút lên/xuống (moveto) — đủ cho mock / desktop.
 */
export function FirewallPage(): React.JSX.Element {
  const { t } = useTranslation()
  const activeId = useConnections((s) => s.activeId)
  const phase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && phase === 'authenticated'
  const { can } = usePermissions(activeId)
  const canModify = can('Sys.Modify', '/')

  if (!connected || !activeId) {
    return <div>{t('dashboard.noConnection')}</div>
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('nav.firewall')}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        {t('firewall.hint')}
      </Typography.Paragraph>
      <Tabs
        items={[
          {
            key: 'rules',
            label: t('firewall.tabRules'),
            children: (
              <RulesPanel
                connectionId={activeId}
                path="/cluster/firewall/rules"
                canModify={canModify}
              />
            ),
          },
          {
            key: 'aliases',
            label: t('firewall.tabAliases'),
            children: <AliasesPanel connectionId={activeId} canModify={canModify} />,
          },
          {
            key: 'ipset',
            label: t('firewall.tabIpset'),
            children: <IpsetPanel connectionId={activeId} canModify={canModify} />,
          },
          {
            key: 'groups',
            label: t('firewall.tabGroups'),
            children: <GroupsPanel connectionId={activeId} canModify={canModify} />,
          },
          {
            key: 'options',
            label: t('firewall.tabOptions'),
            children: <OptionsPanel connectionId={activeId} canModify={canModify} />,
          },
        ]}
      />
    </Space>
  )
}

/** Rules dùng lại cho cluster / node / guest. */
export function RulesPanel({
  connectionId,
  path,
  params,
  canModify,
}: {
  connectionId: string
  path: string
  params?: Record<string, unknown>
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', path, params ?? {})
  const deny = t('access.denied')
  const posPath = `${path}/{pos}`

  const invalidate = (): void => void qc.invalidateQueries({ queryKey: listKey })

  const move = async (pos: number, moveto: number): Promise<void> => {
    try {
      await pveRequest(connectionId, 'PUT', posPath, { ...(params ?? {}), pos, moveto })
      invalidate()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Error')
    }
  }

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path={path}
        params={params ?? {}}
        rowKey={(r) => String(r.pos)}
        emptyText={t('firewall.rulesEmpty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={deny}
            onClick={() => setOpen(true)}
          >
            {t('firewall.addRule')}
          </CapButton>
        }
        columns={[
          { title: '#', dataIndex: 'pos', width: 50 },
          { title: t('firewall.action'), dataIndex: 'action', width: 100 },
          { title: t('firewall.type'), dataIndex: 'type', width: 70 },
          { title: t('firewall.enable'), dataIndex: 'enable', width: 70 },
          { title: 'proto', dataIndex: 'proto', width: 70 },
          { title: 'dport', dataIndex: 'dport', width: 90 },
          { title: t('access.comment'), dataIndex: 'comment' },
          {
            title: '',
            key: 'ops',
            width: 160,
            render: (_, row, index) => (
              <Space size={4}>
                <CapButton
                  size="small"
                  icon={<ArrowUpOutlined />}
                  allowed={canModify}
                  denyReason={deny}
                  disabled={index === 0}
                  onClick={() => void move(Number(row.pos), Number(row.pos) - 1)}
                />
                <CapButton
                  size="small"
                  icon={<ArrowDownOutlined />}
                  allowed={canModify}
                  denyReason={deny}
                  onClick={() => void move(Number(row.pos), Number(row.pos) + 1)}
                />
                <CapButton
                  size="small"
                  danger
                  allowed={canModify}
                  denyReason={deny}
                  onClick={() => {
                    void (async () => {
                      try {
                        await pveRequest(connectionId, 'DELETE', posPath, {
                          ...(params ?? {}),
                          pos: row.pos,
                        })
                        message.success(t('common.delete'))
                        invalidate()
                      } catch (e) {
                        message.error(e instanceof Error ? e.message : 'Error')
                      }
                    })()
                  }}
                >
                  {t('common.delete')}
                </CapButton>
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title={t('firewall.addRule')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ action: string; type: string; proto?: string; dport?: string; comment?: string }>
          initialValues={{ action: 'ACCEPT', type: 'in', proto: 'tcp', dport: '', comment: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', path, {
              ...(params ?? {}),
              action: v.action,
              type: v.type,
              proto: v.proto || undefined,
              dport: v.dport || undefined,
              comment: v.comment || undefined,
              enable: 1,
            })
            message.success(t('firewall.ruleAdded'))
            setOpen(false)
            invalidate()
          }}
        >
          <Form.Item name="action" label={t('firewall.action')} rules={[{ required: true }]}>
            <Select options={['ACCEPT', 'DROP', 'REJECT'].map((a) => ({ value: a, label: a }))} />
          </Form.Item>
          <Form.Item name="type" label={t('firewall.type')} rules={[{ required: true }]}>
            <Select options={['in', 'out'].map((a) => ({ value: a, label: a }))} />
          </Form.Item>
          <Form.Item name="proto" label="proto">
            <Input placeholder="tcp" />
          </Form.Item>
          <Form.Item name="dport" label="dport">
            <Input placeholder="22" />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function AliasesPanel({
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
  const listKey = pveQueryKey(connectionId, 'GET', '/cluster/firewall/aliases', {})

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/firewall/aliases"
        params={{}}
        rowKey="name"
        emptyText={t('firewall.aliasesEmpty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('firewall.addAlias')}
          </CapButton>
        }
        columns={[
          { title: t('firewall.name'), dataIndex: 'name', width: 140 },
          { title: 'CIDR', dataIndex: 'cidr', width: 160 },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
      <Modal open={open} title={t('firewall.addAlias')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ name: string; cidr: string; comment?: string }>
          initialValues={{ name: '', cidr: '', comment: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/cluster/firewall/aliases', v)
            message.success(t('firewall.aliasAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="name" label={t('firewall.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="cidr" label="CIDR" rules={[{ required: true }]}>
            <Input placeholder="192.168.0.0/16" />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function IpsetPanel({
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
  const [selected, setSelected] = useState<string | null>(null)
  const listKey = pveQueryKey(connectionId, 'GET', '/cluster/firewall/ipset', {})

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/firewall/ipset"
        params={{}}
        rowKey="name"
        emptyText={t('firewall.ipsetEmpty')}
        onRow={(row) => ({
          onClick: () => setSelected(String(row.name)),
          style: { cursor: 'pointer' },
        })}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('firewall.addIpset')}
          </CapButton>
        }
        columns={[
          { title: t('firewall.name'), dataIndex: 'name', width: 160 },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
      {selected ? (
        <>
          <Typography.Text strong>
            IPSet: {selected}
          </Typography.Text>
          <PveGrid<Row>
            connectionId={connectionId}
            method="GET"
            path="/cluster/firewall/ipset/{name}"
            params={{ name: selected }}
            rowKey="cidr"
            emptyText="—"
            columns={[
              { title: 'CIDR', dataIndex: 'cidr' },
              { title: t('access.comment'), dataIndex: 'comment' },
            ]}
          />
        </>
      ) : null}
      <Modal open={open} title={t('firewall.addIpset')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ name: string; comment?: string }>
          initialValues={{ name: '', comment: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/cluster/firewall/ipset', v)
            message.success(t('firewall.ipsetAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="name" label={t('firewall.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </Space>
  )
}

function GroupsPanel({
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
  const [selected, setSelected] = useState<string | null>(null)
  const listKey = pveQueryKey(connectionId, 'GET', '/cluster/firewall/groups', {})

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/cluster/firewall/groups"
        params={{}}
        rowKey="group"
        emptyText={t('firewall.groupsEmpty')}
        onRow={(row) => ({
          onClick: () => setSelected(String(row.group)),
          style: { cursor: 'pointer' },
        })}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('firewall.addGroup')}
          </CapButton>
        }
        columns={[
          { title: t('firewall.group'), dataIndex: 'group', width: 160 },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
      {selected ? (
        <RulesPanel
          connectionId={connectionId}
          path="/cluster/firewall/groups/{group}"
          params={{ group: selected }}
          canModify={canModify}
        />
      ) : null}
      <Modal open={open} title={t('firewall.addGroup')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ group: string; comment?: string }>
          initialValues={{ group: '', comment: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/cluster/firewall/groups', v)
            message.success(t('firewall.groupAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="group" label={t('firewall.group')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </Space>
  )
}

function OptionsPanel({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm()

  return (
    <Space direction="vertical">
      <Button
        size="small"
        onClick={() => {
          void (async () => {
            const opts = await pveRequest<Record<string, unknown>>(
              connectionId,
              'GET',
              '/cluster/firewall/options',
              {},
            )
            form.setFieldsValue(opts)
          })()
        }}
      >
        {t('common.retry')}
      </Button>
      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 360 }}
        onFinish={(v) => {
          void (async () => {
            try {
              await pveRequest(connectionId, 'PUT', '/cluster/firewall/options', v)
              message.success(t('common.save'))
            } catch (e) {
              message.error(e instanceof Error ? e.message : 'Error')
            }
          })()
        }}
      >
        <Form.Item name="enable" label={t('firewall.enable')}>
          <InputNumber min={0} max={1} disabled={!canModify} />
        </Form.Item>
        <Form.Item name="policy_in" label="policy_in">
          <Select
            disabled={!canModify}
            options={['ACCEPT', 'DROP', 'REJECT'].map((a) => ({ value: a, label: a }))}
          />
        </Form.Item>
        <Form.Item name="policy_out" label="policy_out">
          <Select
            disabled={!canModify}
            options={['ACCEPT', 'DROP', 'REJECT'].map((a) => ({ value: a, label: a }))}
          />
        </Form.Item>
        <CapButton type="primary" htmlType="submit" allowed={canModify} denyReason={t('access.denied')}>
          {t('common.save')}
        </CapButton>
      </Form>
    </Space>
  )
}
