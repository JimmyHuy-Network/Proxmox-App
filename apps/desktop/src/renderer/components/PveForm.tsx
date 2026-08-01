import { useState } from 'react'
import { App, Button, Form, Space, type FormInstance } from 'antd'
import type { PveErrorPayload } from '@pve/ipc'

/**
 * Wrapper mỏng quanh antd `Form` nối lỗi theo trường từ `PveError` thẳng vào
 * `Form.setFields()` — trừu tượng thứ hai của giai đoạn 4 (docs/plan.md mục 7).
 *
 * `onFinish` tự quyết định gọi endpoint nào (một form có thể gộp nhiều property
 * string thành một PUT config, nên không cố định method/path ở đây). PveForm chỉ
 * lo phần lặp lại: trạng thái submitting, và bóc `error.payload.fieldErrors` mà
 * `pveRequest` đính kèm khi Proxmox trả lỗi tham số.
 */
export function PveForm<TValues extends Record<string, unknown>>({
  form: formProp,
  initialValues,
  onFinish,
  children,
  submitText,
  extra,
  layout = 'vertical',
}: {
  form?: FormInstance<TValues>
  initialValues?: Partial<TValues>
  onFinish: (values: TValues) => Promise<void>
  children: React.ReactNode
  submitText?: string
  extra?: React.ReactNode
  layout?: 'vertical' | 'horizontal' | 'inline'
}): React.JSX.Element {
  const { message } = App.useApp()
  const [internalForm] = Form.useForm<TValues>()
  const form = formProp ?? internalForm
  const [submitting, setSubmitting] = useState(false)

  const handleFinish = async (values: TValues): Promise<void> => {
    setSubmitting(true)
    try {
      await onFinish(values)
    } catch (error) {
      const payload = (error as { payload?: PveErrorPayload }).payload
      if (payload?.fieldErrors) {
        // `NamePath<TValues>` không suy luận được từ chuỗi field trả về lúc chạy
        // (đến từ body lỗi HTTP, không phải kiểu tĩnh) — ép kiểu theo đúng tham
        // số mà `setFields` khai báo thay vì cố khớp generic.
        form.setFields(
          Object.entries(payload.fieldErrors).map(([name, err]) => ({ name, errors: [err] })) as Parameters<
            typeof form.setFields
          >[0],
        )
      } else {
        message.error(error instanceof Error ? error.message : 'Thao tác thất bại')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form form={form} layout={layout} initialValues={initialValues} onFinish={(v: TValues) => void handleFinish(v)}>
      {children}
      <Form.Item style={{ marginBottom: 0 }}>
        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {submitText ?? 'Lưu'}
          </Button>
          {extra}
        </Space>
      </Form.Item>
    </Form>
  )
}
