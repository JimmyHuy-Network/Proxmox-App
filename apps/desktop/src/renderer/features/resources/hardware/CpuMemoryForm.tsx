import { Form, InputNumber } from 'antd'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../../components/PveForm'

export interface CpuMemoryValues {
  [key: string]: unknown
  cores?: number
  sockets?: number
  memory?: number
  swap?: number
}

/**
 * Form sửa CPU + bộ nhớ (scalar trên PUT config). Tái sử dụng được trong wizard tạo VM.
 */
export function CpuMemoryForm({
  guestType,
  initialValues,
  submitText,
  onFinish,
  extra,
}: {
  guestType: 'qemu' | 'lxc'
  initialValues?: Partial<CpuMemoryValues>
  submitText?: string
  onFinish: (values: CpuMemoryValues) => Promise<void>
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <PveForm<CpuMemoryValues> initialValues={initialValues} submitText={submitText} onFinish={onFinish} extra={extra}>
      <Form.Item
        name="cores"
        label={t('guest.hardwareCores')}
        rules={[{ required: true, type: 'number', min: 1, max: 512 }]}
      >
        <InputNumber min={1} max={512} style={{ width: '100%' }} />
      </Form.Item>
      {guestType === 'qemu' ? (
        <Form.Item
          name="sockets"
          label={t('guest.hardwareSockets')}
          rules={[{ required: true, type: 'number', min: 1, max: 16 }]}
        >
          <InputNumber min={1} max={16} style={{ width: '100%' }} />
        </Form.Item>
      ) : null}
      <Form.Item
        name="memory"
        label={t('guest.hardwareMemoryMiB')}
        rules={[{ required: true, type: 'number', min: 16 }]}
      >
        <InputNumber min={16} step={128} style={{ width: '100%' }} />
      </Form.Item>
      {guestType === 'lxc' ? (
        <Form.Item name="swap" label={t('guest.hardwareSwapMiB')} rules={[{ type: 'number', min: 0 }]}>
          <InputNumber min={0} step={128} style={{ width: '100%' }} />
        </Form.Item>
      ) : null}
    </PveForm>
  )
}
