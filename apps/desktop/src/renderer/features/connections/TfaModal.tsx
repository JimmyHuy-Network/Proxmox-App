import { useState } from 'react'
import { Alert, Input, Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

/** Hộp thoại nhập mã OTP cho bước hai của xác thực hai lớp. */
export function TfaModal({
  open,
  onSubmit,
  onCancel,
  error,
  loading,
}: {
  open: boolean
  onSubmit: (code: string) => void
  onCancel: () => void
  error?: string | null
  loading?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [code, setCode] = useState('')

  const submit = (): void => {
    if (code.trim().length > 0) onSubmit(code.trim())
  }

  return (
    <Modal
      title={t('tfa.title')}
      open={open}
      onOk={submit}
      onCancel={onCancel}
      okText={t('tfa.submit')}
      okButtonProps={{ disabled: code.trim().length === 0 }}
      confirmLoading={loading}
      afterClose={() => setCode('')}
      width={420}
    >
      <Typography.Paragraph type="secondary">{t('tfa.intro')}</Typography.Paragraph>
      <Input
        autoFocus
        size="large"
        inputMode="numeric"
        maxLength={8}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        onPressEnter={submit}
        style={{ letterSpacing: 6, textAlign: 'center', fontSize: 20 }}
      />
      {error && <Alert type="error" showIcon title={error} style={{ marginTop: 12 }} />}
    </Modal>
  )
}
