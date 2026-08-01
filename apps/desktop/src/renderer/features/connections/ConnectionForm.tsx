import { useState } from 'react'
import { Alert, App, Form, Input, InputNumber, Modal, Segmented, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ConnectionInput, ConnectionSummary } from '@pve/ipc'

interface FormValues {
  name: string
  host: string
  port: number
  authMode: 'ticket' | 'token'
  username: string
  password?: string
  tokenId?: string
  tokenSecret?: string
}

/**
 * Form thêm/sửa kết nối.
 *
 * Bí mật (mật khẩu, token secret) chỉ đi lên main để mã hóa; khi sửa một kết nối
 * đã có, bỏ trống các trường này nghĩa là giữ nguyên bí mật cũ.
 */
export function ConnectionForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: ConnectionSummary | null
  onClose: () => void
  onSaved: (summary: ConnectionSummary) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [authMode, setAuthMode] = useState<'ticket' | 'token'>('ticket')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  // Khởi tạo khi hộp thoại vừa mở. Dùng afterOpenChange thay cho useEffect: reset
  // state ngay trong effect vi phạm quy tắc react-hooks, và bản chất đây là phản
  // ứng với sự kiện "mở", không phải đồng bộ hóa với dữ liệu.
  const initForm = (opened: boolean): void => {
    if (!opened) return
    setTestResult(null)
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        host: editing.host,
        port: editing.port,
        authMode: editing.authMode,
        username: editing.username,
      })
      setAuthMode(editing.authMode)
    } else {
      form.resetFields()
      form.setFieldsValue({ port: 8006, authMode: 'ticket' })
      setAuthMode('ticket')
    }
  }

  const buildInput = (values: FormValues): ConnectionInput => ({
    ...(editing ? { id: editing.id } : {}),
    name: values.name,
    host: values.host,
    port: values.port,
    authMode: values.authMode,
    username: values.username,
    ...(values.password ? { password: values.password } : {}),
    ...(values.tokenId ? { tokenId: values.tokenId } : {}),
    ...(values.tokenSecret ? { tokenSecret: values.tokenSecret } : {}),
    // Cert tự ký được xác nhận qua luồng TOFU khi kết nối, không tick ở đây.
    allowSelfSigned: false,
  })

  const handleTest = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      setTestResult(null)
      // Test bỏ qua bước ghim cert (chỉ kiểm nhanh credential + server sống).
      const res = await window.pve.vault.test({ ...buildInput(values), allowSelfSigned: true })
      if (!res.ok) {
        setTestResult({ ok: false, text: res.message })
        return
      }
      const r = res.data
      if (r.status === 'ok') {
        setTestResult({ ok: true, text: t('connections.testOk', { version: r.version }) })
      } else if (r.status === 'tfa-required') {
        setTestResult({ ok: true, text: t('connections.status.tfa-challenge') })
      } else if (r.status === 'cert-untrusted') {
        setTestResult({ ok: true, text: `${t('cert.fingerprint')}: ${r.cert.fingerprint256}` })
      } else {
        setTestResult({ ok: false, text: r.message })
      }
    } catch {
      // lỗi validate form — antd đã hiện dưới field
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const res = await window.pve.vault.upsert(buildInput(values))
      if (!res.ok) {
        message.error(res.message)
        return
      }
      onSaved(res.data)
      onClose()
    } catch {
      // lỗi validate
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editing ? t('connections.edit') : t('connections.add')}
      open={open}
      afterOpenChange={initForm}
      onCancel={onClose}
      width={560}
      okText={t('connections.save')}
      confirmLoading={saving}
      onOk={handleSave}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <button
            type="button"
            className="ant-btn ant-btn-default"
            onClick={handleTest}
            disabled={testing}
            style={{ marginInlineEnd: 'auto' }}
          >
            {testing ? t('connections.testing') : t('connections.test')}
          </button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="name" label={t('connections.name')} rules={[{ required: true }]}>
          <Input placeholder="pve-lab" />
        </Form.Item>

        <Space.Compact block>
          <Form.Item
            name="host"
            label={t('connections.host')}
            rules={[{ required: true }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="192.168.1.10" />
          </Form.Item>
          <Form.Item name="port" label={t('connections.port')} style={{ width: 110, marginInlineStart: 8 }}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
        </Space.Compact>

        <Form.Item name="authMode" label={t('connections.authMode')}>
          <Segmented
            options={[
              { label: t('connections.authTicket'), value: 'ticket' },
              { label: t('connections.authToken'), value: 'token' },
            ]}
            onChange={(v) => setAuthMode(v as 'ticket' | 'token')}
          />
        </Form.Item>

        <Form.Item
          name="username"
          label={t('connections.username')}
          rules={[{ required: true }]}
          extra={t('connections.usernameHint')}
        >
          <Input placeholder="root@pam" />
        </Form.Item>

        {authMode === 'ticket' ? (
          <Form.Item
            name="password"
            label={t('connections.password')}
            rules={editing ? [] : [{ required: true }]}
            extra={editing ? t('connections.passwordKeepHint') : undefined}
          >
            <Input.Password autoComplete="off" />
          </Form.Item>
        ) : (
          <Space.Compact block>
            <Form.Item
              name="tokenId"
              label={t('connections.tokenId')}
              rules={editing ? [] : [{ required: true }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="automation" />
            </Form.Item>
            <Form.Item
              name="tokenSecret"
              label={t('connections.tokenSecret')}
              rules={editing ? [] : [{ required: true }]}
              style={{ flex: 2, marginInlineStart: 8 }}
            >
              <Input.Password autoComplete="off" placeholder="xxxxxxxx-xxxx-…" />
            </Form.Item>
          </Space.Compact>
        )}

        {testResult && (
          <Alert
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            message={testResult.text}
            style={{ marginTop: 8 }}
          />
        )}
      </Form>
    </Modal>
  )
}
