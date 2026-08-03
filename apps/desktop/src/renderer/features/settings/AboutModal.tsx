import { Button, Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

/** Modal Giới thiệu — mở từ Settings hoặc menu Help. */
export function AboutModal({
  open,
  onClose,
  version,
}: {
  open: boolean
  onClose: () => void
  version?: { app?: string; electron?: string } | null
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Modal
      open={open}
      title={t('settings.about')}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <Typography.Paragraph>
        <Typography.Text strong>{t('app.name')}</Typography.Text>
        <br />
        {t('app.tagline')}
        <br />
        v{version?.app ?? '…'} · Electron {version?.electron ?? '…'}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">{t('settings.aboutHint')}</Typography.Paragraph>
    </Modal>
  )
}
