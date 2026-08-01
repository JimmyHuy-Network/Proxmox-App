import { Checkbox, Form, Input, InputNumber, Select } from 'antd'
import { PVE_PROPERTY_SCHEMAS, formatPropertyString, parsePropertyString, propBool } from '@pve/api'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../../components/PveForm'

export interface NetworkFormValues {
  [key: string]: unknown
  /** Chỉ dùng khi thêm mới — khóa `netN`. */
  deviceKey?: string
  model?: string
  macaddr?: string
  name?: string
  hwaddr?: string
  bridge?: string
  firewall?: boolean
  tag?: number
  ip?: string
}

const QEMU_MODELS = ['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3', 'pcnet'] as const

/**
 * Form card mạng — encode/decode qua `PVE_PROPERTY_SCHEMAS` (`qemu.net` / `lxc.net`).
 */
export function NetworkForm({
  guestType,
  mode,
  deviceKey,
  rawValue,
  submitText,
  onFinish,
  extra,
}: {
  guestType: 'qemu' | 'lxc'
  mode: 'add' | 'edit'
  deviceKey: string
  rawValue?: string
  submitText?: string
  onFinish: (deviceKey: string, encoded: string) => Promise<void>
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const schemaName = guestType === 'lxc' ? 'lxc.net' : 'qemu.net'
  const schema = PVE_PROPERTY_SCHEMAS[schemaName]

  const parsed = rawValue ? parsePropertyString(rawValue, schema) : {}
  const initialValues: NetworkFormValues =
    guestType === 'lxc'
      ? {
          deviceKey,
          name: parsed['name'] ?? 'eth0',
          hwaddr: parsed['hwaddr'],
          bridge: parsed['bridge'] ?? 'vmbr0',
          firewall: propBool(parsed, 'firewall') ?? false,
          tag: parsed['tag'] ? Number(parsed['tag']) : undefined,
          ip: parsed['ip'],
        }
      : {
          deviceKey,
          model: parsed['model'] ?? 'virtio',
          macaddr: parsed['macaddr'],
          bridge: parsed['bridge'] ?? 'vmbr0',
          firewall: propBool(parsed, 'firewall') ?? true,
          tag: parsed['tag'] ? Number(parsed['tag']) : undefined,
        }

  return (
    <PveForm<NetworkFormValues>
      key={`${mode}-${deviceKey}-${rawValue ?? ''}`}
      initialValues={initialValues}
      submitText={submitText}
      extra={extra}
      onFinish={async (values) => {
        const key = mode === 'add' ? String(values.deviceKey ?? deviceKey) : deviceKey
        let encoded: string
        if (guestType === 'lxc') {
          encoded = formatPropertyString(
            {
              name: String(values.name ?? 'eth0'),
              hwaddr: values.hwaddr ? String(values.hwaddr) : undefined,
              bridge: values.bridge ? String(values.bridge) : undefined,
              firewall: values.firewall ? true : undefined,
              tag: values.tag,
              ip: values.ip ? String(values.ip) : undefined,
            },
            schema,
          )
        } else {
          encoded = formatPropertyString(
            {
              model: String(values.model ?? 'virtio'),
              macaddr: values.macaddr ? String(values.macaddr) : undefined,
              bridge: values.bridge ? String(values.bridge) : undefined,
              firewall: values.firewall ? true : undefined,
              tag: values.tag,
            },
            schema,
          )
        }
        await onFinish(key, encoded)
      }}
    >
      {mode === 'add' ? (
        <Form.Item name="deviceKey" label={t('guest.hardwareDeviceKey')} rules={[{ required: true }]}>
          <Input disabled />
        </Form.Item>
      ) : null}
      {guestType === 'qemu' ? (
        <>
          <Form.Item name="model" label={t('guest.hardwareNetModel')} rules={[{ required: true }]}>
            <Select
              options={QEMU_MODELS.map((m) => ({ value: m, label: m }))}
              showSearch
            />
          </Form.Item>
          <Form.Item name="macaddr" label={t('guest.hardwareMac')}>
            <Input placeholder="AA:BB:CC:DD:EE:FF" />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item name="name" label={t('guest.hardwareNetName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="hwaddr" label={t('guest.hardwareMac')}>
            <Input placeholder="AA:BB:CC:DD:EE:FF" />
          </Form.Item>
          <Form.Item name="ip" label={t('guest.hardwareNetIp')}>
            <Input placeholder="dhcp" />
          </Form.Item>
        </>
      )}
      <Form.Item name="bridge" label={t('guest.hardwareBridge')} rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="tag" label={t('guest.hardwareVlanTag')}>
        <InputNumber min={1} max={4094} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="firewall" valuePropName="checked">
        <Checkbox>{t('guest.hardwareFirewall')}</Checkbox>
      </Form.Item>
    </PveForm>
  )
}
