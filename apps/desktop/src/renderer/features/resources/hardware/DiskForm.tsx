import { Checkbox, Form, Input, InputNumber, Select } from 'antd'
import { PVE_PROPERTY_SCHEMAS, formatPropertyString, parsePropertyString, propBool } from '@pve/api'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../../components/PveForm'
import { nextDiskKey, schemaNameForKey } from './config-keys'

export interface DiskFormValues {
  [key: string]: unknown
  deviceKey?: string
  bus?: 'scsi' | 'virtio' | 'ide' | 'sata'
  storage?: string
  sizeGb?: number
  file?: string
  volume?: string
  mp?: string
  iothread?: boolean
  backup?: boolean
}

/**
 * Form đĩa / mount point. Thêm mới: `storage:size` (GB). Sửa: giữ `file`/`volume`,
 * chỉnh cờ phụ (iothread, backup, mp…).
 */
export function DiskForm({
  guestType,
  mode,
  deviceKey,
  rawValue,
  config = {},
  defaultBus = 'scsi',
  submitText,
  onFinish,
  extra,
}: {
  guestType: 'qemu' | 'lxc'
  mode: 'add' | 'edit'
  deviceKey: string
  rawValue?: string
  /** Config hiện tại — dùng để chọn slot đĩa trống khi đổi bus lúc thêm mới. */
  config?: Record<string, unknown>
  defaultBus?: 'scsi' | 'virtio' | 'ide' | 'sata'
  submitText?: string
  onFinish: (deviceKey: string, encoded: string) => Promise<void>
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const schemaName = schemaNameForKey(deviceKey === 'rootfs' || deviceKey.startsWith('mp') ? deviceKey : `${defaultBus}0`, guestType)
  const schema = schemaName ? PVE_PROPERTY_SCHEMAS[schemaName] : undefined
  const parsed = rawValue ? parsePropertyString(rawValue, schema) : {}

  const busFromKey = /^(scsi|virtio|ide|sata)\d+$/.exec(deviceKey)?.[1] as
    | 'scsi'
    | 'virtio'
    | 'ide'
    | 'sata'
    | undefined

  const initialValues: DiskFormValues = {
    deviceKey,
    bus: busFromKey ?? defaultBus,
    file: parsed['file'],
    volume: parsed['volume'],
    mp: parsed['mp'],
    storage: 'local-lvm',
    sizeGb: 32,
    iothread: propBool(parsed, 'iothread'),
    backup: propBool(parsed, 'backup'),
  }

  return (
    <PveForm<DiskFormValues>
      key={`${mode}-${deviceKey}-${rawValue ?? ''}`}
      initialValues={initialValues}
      submitText={submitText}
      extra={extra}
      onFinish={async (values) => {
        let key = deviceKey
        let encoded: string

        if (guestType === 'lxc') {
          if (mode === 'add') {
            key = String(values.deviceKey ?? deviceKey)
            const size = `${Number(values.sizeGb ?? 8)}G`
            const volume = `${String(values.storage ?? 'local-lvm')}:${Number(values.sizeGb ?? 8)}`
            encoded = formatPropertyString(
              {
                volume,
                size,
                mp: key === 'rootfs' ? undefined : String(values.mp ?? '/data'),
                backup: values.backup ? true : undefined,
              },
              PVE_PROPERTY_SCHEMAS[key === 'rootfs' ? 'rootfs' : 'mp'],
            )
          } else {
            const editSchema = PVE_PROPERTY_SCHEMAS[deviceKey === 'rootfs' ? 'rootfs' : 'mp']
            encoded = formatPropertyString(
              {
                volume: parsed['volume'] ?? values.volume,
                size: parsed['size'],
                mp: deviceKey === 'rootfs' ? undefined : (values.mp ? String(values.mp) : parsed['mp']),
                backup: values.backup ? true : undefined,
                ro: propBool(parsed, 'ro'),
              },
              editSchema,
            )
          }
        } else if (mode === 'add') {
          const bus = (values.bus ?? defaultBus) as 'scsi' | 'virtio' | 'ide' | 'sata'
          key = nextDiskKey(config, bus)
          const sizeGb = Number(values.sizeGb ?? 32)
          const file = `${String(values.storage ?? 'local-lvm')}:${sizeGb}`
          const addSchema = PVE_PROPERTY_SCHEMAS[bus]
          encoded = formatPropertyString(
            {
              file,
              size: `${sizeGb}G`,
              iothread: bus === 'scsi' || bus === 'virtio' ? Boolean(values.iothread) : undefined,
              backup: values.backup === false ? false : undefined,
            },
            addSchema,
          )
        } else {
          const editSchemaName = schemaNameForKey(deviceKey, 'qemu')
          const editSchema = editSchemaName ? PVE_PROPERTY_SCHEMAS[editSchemaName] : undefined
          encoded = formatPropertyString(
            {
              file: parsed['file'],
              size: parsed['size'],
              media: parsed['media'],
              iothread: values.iothread ? true : undefined,
              backup: values.backup === false ? false : values.backup ? true : undefined,
              cache: parsed['cache'],
              discard: parsed['discard'],
              ssd: parsed['ssd'],
            },
            editSchema,
          )
        }

        await onFinish(key, encoded)
      }}
    >
      {mode === 'add' && guestType === 'qemu' ? (
        <Form.Item name="bus" label={t('guest.hardwareDiskBus')} rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'scsi', label: 'SCSI' },
              { value: 'virtio', label: 'VirtIO Block' },
              { value: 'sata', label: 'SATA' },
              { value: 'ide', label: 'IDE' },
            ]}
          />
        </Form.Item>
      ) : null}
      {mode === 'add' ? (
        <>
          {guestType === 'lxc' ? (
            <Form.Item name="deviceKey" label={t('guest.hardwareDeviceKey')} rules={[{ required: true }]}>
              <Input disabled />
            </Form.Item>
          ) : null}
          <Form.Item name="storage" label={t('guest.hardwareStorage')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="sizeGb"
            label={t('guest.hardwareDiskSizeGb')}
            rules={[{ required: true, type: 'number', min: 1 }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </>
      ) : (
        <Form.Item label={t('guest.hardwareDiskFile')}>
          <Input value={parsed['file'] ?? parsed['volume'] ?? rawValue} disabled />
        </Form.Item>
      )}
      {guestType === 'lxc' && deviceKey !== 'rootfs' && (mode === 'edit' || deviceKey.startsWith('mp')) ? (
        <Form.Item name="mp" label={t('guest.hardwareMountPoint')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      ) : null}
      {guestType === 'qemu' && (deviceKey.startsWith('scsi') || deviceKey.startsWith('virtio') || mode === 'add') ? (
        <Form.Item name="iothread" valuePropName="checked">
          <Checkbox>{t('guest.hardwareIoThread')}</Checkbox>
        </Form.Item>
      ) : null}
      <Form.Item name="backup" valuePropName="checked">
        <Checkbox>{t('guest.hardwareBackup')}</Checkbox>
      </Form.Item>
    </PveForm>
  )
}
