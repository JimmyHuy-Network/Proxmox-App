import { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { PveForm } from '../../components/PveForm'
import { TaskButton } from '../../components/TaskButton'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface NetRow {
  [key: string]: unknown
  iface: string
  type?: string
  method?: string
  active?: number | boolean
  address?: string
  cidr?: string
  gateway?: string
  bridge_ports?: string
  slaves?: string
  comments?: string
}

interface CreateValues {
  [key: string]: unknown
  iface: string
  type: string
  address?: string
  netmask?: string
  gateway?: string
  bridge_ports?: string
  slaves?: string
  bond_mode?: string
  'vlan-id'?: string
  'vlan-raw-device'?: string
  comments?: string
  autostart?: boolean
}

const IFACE_TYPES = ['bridge', 'bond', 'vlan', 'eth', 'OVSBridge', 'OVSBond'] as const

/**
 * Tab mạng node: list + tạo bridge/bond/vlan, Apply (reload) / Revert pending.
 */
export function NetworkTab({
  connectionId,
  node,
}: {
  connectionId: string
  node: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [form] = Form.useForm<CreateValues>()
  const type = Form.useWatch('type', form) ?? 'bridge'

  const listKey = pveQueryKey(connectionId, 'GET', '/nodes/{node}/network', { node })
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: listKey })
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {pending && <Alert type="warning" showIcon message={t('node.networkPending')} />}

      <PveGrid<NetRow>
        connectionId={connectionId}
        method="GET"
        path="/nodes/{node}/network"
        params={{ node }}
        rowKey="iface"
        refetchInterval={8000}
        emptyText={t('node.networkEmpty')}
        search={(row, q) =>
          row.iface.toLowerCase().includes(q.toLowerCase()) ||
          (row.type?.toLowerCase().includes(q.toLowerCase()) ?? false) ||
          (row.address?.toLowerCase().includes(q.toLowerCase()) ?? false)
        }
        searchPlaceholder={t('node.networkSearch')}
        toolbar={
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields()
                form.setFieldsValue({ type: 'bridge', autostart: true })
                setCreateOpen(true)
              }}
            >
              {t('node.networkAdd')}
            </Button>
            <TaskButton
              connectionId={connectionId}
              method="PUT"
              path="/nodes/{node}/network"
              params={{ node }}
              label={t('node.networkApply')}
              type="primary"
              onDone={() => {
                setPending(false)
                invalidate()
                message.success(t('node.networkApplied'))
              }}
            />
            <Button
              danger
              onClick={() => {
                void (async () => {
                  await pveRequest(connectionId, 'DELETE', '/nodes/{node}/network', { node })
                  setPending(false)
                  invalidate()
                  message.success(t('node.networkReverted'))
                })()
              }}
            >
              {t('node.networkRevert')}
            </Button>
          </Space>
        }
        columns={[
          { title: t('node.iface'), dataIndex: 'iface', width: 120 },
          { title: t('node.ifaceType'), dataIndex: 'type', width: 100 },
          {
            title: t('common.status'),
            dataIndex: 'active',
            width: 90,
            render: (v: number | boolean | undefined) =>
              v ? <Tag color="success">{t('node.active')}</Tag> : <Tag>{t('node.inactive')}</Tag>,
          },
          {
            title: t('node.address'),
            key: 'addr',
            render: (_, row) => row.cidr ?? row.address ?? '—',
          },
          { title: t('node.gateway'), dataIndex: 'gateway', width: 130, render: (v) => v ?? '—' },
          {
            title: t('node.ports'),
            key: 'ports',
            render: (_, row) => row.bridge_ports ?? row.slaves ?? '—',
          },
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_, row) =>
              row.type === 'bridge' || row.type === 'bond' || row.type === 'vlan' ? (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    void (async () => {
                      await pveRequest(connectionId, 'DELETE', '/nodes/{node}/network/{iface}', {
                        node,
                        iface: row.iface,
                      })
                      setPending(true)
                      invalidate()
                    })()
                  }}
                >
                  {t('common.delete')}
                </Button>
              ) : null,
          },
        ]}
      />

      <Modal
        open={createOpen}
        title={t('node.networkAdd')}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnHidden
        width={520}
      >
        <PveForm<CreateValues>
          form={form}
          submitText={t('common.save')}
          initialValues={{ type: 'bridge', autostart: true }}
          onFinish={async (values) => {
            await pveRequest(connectionId, 'POST', '/nodes/{node}/network', {
              node,
              ...values,
              autostart: values.autostart ? 1 : 0,
            })
            setCreateOpen(false)
            setPending(true)
            invalidate()
            message.success(t('node.networkCreated'))
          }}
        >
          <Form.Item name="iface" label={t('node.iface')} rules={[{ required: true }]}>
            <Input placeholder="vmbr1" />
          </Form.Item>
          <Form.Item name="type" label={t('node.ifaceType')} rules={[{ required: true }]}>
            <Select options={IFACE_TYPES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          {(type === 'bridge' || type === 'OVSBridge') && (
            <Form.Item name="bridge_ports" label={t('node.bridgePorts')}>
              <Input placeholder="eth1" />
            </Form.Item>
          )}
          {(type === 'bond' || type === 'OVSBond') && (
            <>
              <Form.Item name="slaves" label={t('node.slaves')} rules={[{ required: true }]}>
                <Input placeholder="eth1 eth2" />
              </Form.Item>
              <Form.Item name="bond_mode" label={t('node.bondMode')}>
                <Select
                  allowClear
                  options={['balance-rr', 'active-backup', '802.3ad'].map((v) => ({
                    value: v,
                    label: v,
                  }))}
                />
              </Form.Item>
            </>
          )}
          {type === 'vlan' && (
            <>
              <Form.Item name="vlan-raw-device" label={t('node.vlanRaw')} rules={[{ required: true }]}>
                <Input placeholder="vmbr0" />
              </Form.Item>
              <Form.Item name="vlan-id" label="VLAN ID" rules={[{ required: true }]}>
                <Input placeholder="100" />
              </Form.Item>
            </>
          )}
          <Form.Item name="address" label={t('node.address')}>
            <Input placeholder="192.168.1.10" />
          </Form.Item>
          <Form.Item name="netmask" label={t('node.netmask')}>
            <Input placeholder="255.255.255.0" />
          </Form.Item>
          <Form.Item name="gateway" label={t('node.gateway')}>
            <Input placeholder="192.168.1.1" />
          </Form.Item>
          <Form.Item name="comments" label={t('node.comments')}>
            <Input />
          </Form.Item>
          <Form.Item name="autostart" label={t('node.autostart')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t('node.networkCreateHint')}
          </Typography.Paragraph>
        </PveForm>
      </Modal>
    </Space>
  )
}
