import { Checkbox, Form, Input, Select } from 'antd'
import { PVE_PROPERTY_SCHEMAS, formatPropertyString, parsePropertyString, propBool } from '@pve/api'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../../components/PveForm'
import type { HardwareGroup } from './config-keys'

export type AdvancedKind = Extract<HardwareGroup, 'usb' | 'audio' | 'serial' | 'pci' | 'cdrom' | 'efi'>

interface AdvancedValues {
  [key: string]: unknown
  deviceKey?: string
  host?: string
  mapping?: string
  usb3?: boolean
  device?: string
  driver?: string
  path?: string
  pciHost?: string
  iso?: string
  efiStorage?: string
  tpmVersion?: string
  efiKind?: 'efidisk0' | 'tpmstate0'
}

/**
 * Form thiết bị nâng cao QEMU: USB, audio, serial, PCI, CD/DVD, EFI/TPM.
 * Serial/PCI không có sub-schema sinh sẵn — lưu chuỗi thô.
 */
export function AdvancedDeviceForm({
  kind,
  mode,
  deviceKey,
  rawValue,
  submitText,
  onFinish,
  extra,
}: {
  kind: AdvancedKind
  mode: 'add' | 'edit'
  deviceKey: string
  rawValue?: string
  submitText?: string
  onFinish: (deviceKey: string, encoded: string) => Promise<void>
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()

  let initialValues: AdvancedValues = { deviceKey }
  if (kind === 'usb') {
    const parsed = parsePropertyString(rawValue ?? '', PVE_PROPERTY_SCHEMAS['usb'])
    initialValues = {
      deviceKey,
      host: parsed['host'],
      mapping: parsed['mapping'],
      usb3: propBool(parsed, 'usb3') ?? false,
    }
  } else if (kind === 'audio') {
    const parsed = parsePropertyString(rawValue ?? '', PVE_PROPERTY_SCHEMAS['audio0'])
    initialValues = {
      deviceKey: 'audio0',
      device: parsed['device'] ?? 'ich9-intel-hda',
      driver: parsed['driver'] ?? 'spice',
    }
  } else if (kind === 'serial') {
    initialValues = { deviceKey, path: rawValue || 'socket' }
  } else if (kind === 'pci') {
    initialValues = { deviceKey, pciHost: rawValue || '' }
  } else if (kind === 'cdrom') {
    const parsed = parsePropertyString(rawValue ?? '', PVE_PROPERTY_SCHEMAS['ide'])
    initialValues = { deviceKey, iso: parsed['file'] ?? 'none' }
  } else if (kind === 'efi') {
    const isTpm = deviceKey.startsWith('tpm')
    const schema = PVE_PROPERTY_SCHEMAS[isTpm ? 'tpmstate0' : 'efidisk0']
    const parsed = parsePropertyString(rawValue ?? '', schema)
    initialValues = {
      deviceKey,
      efiKind: isTpm ? 'tpmstate0' : 'efidisk0',
      efiStorage: parsed['file'] ?? parsed['volume'] ?? 'local-lvm:1',
      tpmVersion: parsed['version'] ?? 'v2.0',
    }
  }

  return (
    <PveForm<AdvancedValues>
      key={`${kind}-${mode}-${deviceKey}-${rawValue ?? ''}`}
      initialValues={initialValues}
      submitText={submitText}
      extra={extra}
      onFinish={async (values) => {
        let key = deviceKey
        let encoded = ''

        if (kind === 'usb') {
          key = mode === 'add' ? String(values.deviceKey ?? deviceKey) : deviceKey
          encoded = formatPropertyString(
            {
              host: values.host ? String(values.host) : undefined,
              mapping: values.mapping ? String(values.mapping) : undefined,
              usb3: values.usb3 ? true : undefined,
            },
            PVE_PROPERTY_SCHEMAS['usb'],
          )
        } else if (kind === 'audio') {
          key = 'audio0'
          encoded = formatPropertyString(
            {
              device: String(values.device ?? 'ich9-intel-hda'),
              driver: values.driver ? String(values.driver) : undefined,
            },
            PVE_PROPERTY_SCHEMAS['audio0'],
          )
        } else if (kind === 'serial') {
          key = mode === 'add' ? String(values.deviceKey ?? deviceKey) : deviceKey
          encoded = String(values.path ?? 'socket')
        } else if (kind === 'pci') {
          key = mode === 'add' ? String(values.deviceKey ?? deviceKey) : deviceKey
          encoded = String(values.pciHost ?? '').trim()
        } else if (kind === 'cdrom') {
          key = mode === 'add' ? String(values.deviceKey ?? deviceKey) : deviceKey
          encoded = formatPropertyString(
            { file: String(values.iso || 'none'), media: 'cdrom' },
            PVE_PROPERTY_SCHEMAS['ide'],
          )
        } else if (kind === 'efi') {
          const efiKind = (values.efiKind ?? 'efidisk0') as 'efidisk0' | 'tpmstate0'
          key = efiKind
          if (efiKind === 'tpmstate0') {
            encoded = formatPropertyString(
              {
                file: String(values.efiStorage ?? 'local-lvm:1'),
                version: values.tpmVersion ? String(values.tpmVersion) : 'v2.0',
              },
              PVE_PROPERTY_SCHEMAS['tpmstate0'],
            )
          } else {
            encoded = formatPropertyString(
              { file: String(values.efiStorage ?? 'local-lvm:1'), efitype: '4m', 'pre-enrolled-keys': 1 },
              PVE_PROPERTY_SCHEMAS['efidisk0'],
            )
          }
        }

        await onFinish(key, encoded)
      }}
    >
      {mode === 'add' && kind !== 'audio' && kind !== 'efi' ? (
        <Form.Item name="deviceKey" label={t('guest.hardwareDeviceKey')} rules={[{ required: true }]}>
          <Input disabled />
        </Form.Item>
      ) : null}

      {kind === 'usb' ? (
        <>
          <Form.Item name="host" label={t('guest.hardwareUsbHost')} help={t('guest.hardwareUsbHostHelp')}>
            <Input placeholder="0000:00:00.0 or spice" />
          </Form.Item>
          <Form.Item name="mapping" label={t('guest.hardwareUsbMapping')}>
            <Input />
          </Form.Item>
          <Form.Item name="usb3" valuePropName="checked">
            <Checkbox>USB 3.0</Checkbox>
          </Form.Item>
        </>
      ) : null}

      {kind === 'audio' ? (
        <>
          <Form.Item name="device" label={t('guest.hardwareAudioDevice')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'ich9-intel-hda', label: 'ich9-intel-hda' },
                { value: 'intel-hda', label: 'intel-hda' },
                { value: 'AC97', label: 'AC97' },
              ]}
            />
          </Form.Item>
          <Form.Item name="driver" label={t('guest.hardwareAudioDriver')}>
            <Select
              options={[
                { value: 'spice', label: 'spice' },
                { value: 'none', label: 'none' },
              ]}
            />
          </Form.Item>
        </>
      ) : null}

      {kind === 'serial' ? (
        <Form.Item name="path" label={t('guest.hardwareSerialPath')} rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'socket', label: 'socket' },
              { value: '/dev/ttyS0', label: '/dev/ttyS0' },
              { value: '/dev/ttyS1', label: '/dev/ttyS1' },
            ]}
          />
        </Form.Item>
      ) : null}

      {kind === 'pci' ? (
        <Form.Item
          name="pciHost"
          label={t('guest.hardwarePciHost')}
          rules={[{ required: true }]}
          help={t('guest.hardwarePciHostHelp')}
        >
          <Input placeholder="0000:01:00.0" />
        </Form.Item>
      ) : null}

      {kind === 'cdrom' ? (
        <Form.Item name="iso" label={t('wizard.iso')} rules={[{ required: true }]} help={t('wizard.isoHelp')}>
          <Input placeholder="local:iso/debian-13.iso or none" />
        </Form.Item>
      ) : null}

      {kind === 'efi' ? (
        <>
          {mode === 'add' ? (
            <Form.Item name="efiKind" label={t('guest.hardwareEfiKind')} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'efidisk0', label: 'EFI Disk' },
                  { value: 'tpmstate0', label: 'TPM State' },
                ]}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="efiStorage" label={t('guest.hardwareStorage')} rules={[{ required: true }]}>
            <Input placeholder="local-lvm:1" />
          </Form.Item>
          <Form.Item name="tpmVersion" label={t('guest.hardwareTpmVersion')}>
            <Select
              options={[
                { value: 'v1.2', label: 'v1.2' },
                { value: 'v2.0', label: 'v2.0' },
              ]}
            />
          </Form.Item>
        </>
      ) : null}
    </PveForm>
  )
}
