import { Alert, Descriptions, Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CertInfo } from '@pve/ipc'

/**
 * Hộp thoại xác nhận chứng chỉ (trust-on-first-use).
 *
 * Hiển thị vân tay để người dùng đối chiếu với `pvenode cert info` trên server.
 * Vân tay in dạng cặp hai ký tự cho dễ so bằng mắt — sai một cặp là chứng chỉ khác.
 */
export function CertTrustModal({
  cert,
  open,
  onTrust,
  onCancel,
  loading,
}: {
  cert: CertInfo | null
  open: boolean
  onTrust: () => void
  onCancel: () => void
  loading?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('cert.title')}
      open={open}
      onOk={onTrust}
      onCancel={onCancel}
      okText={t('cert.trust')}
      cancelText={t('cert.cancel')}
      confirmLoading={loading}
      width={620}
    >
      <Alert type="warning" showIcon message={t('cert.intro')} style={{ marginBottom: 16 }} />
      {cert && (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('cert.fingerprint')}>
            <Typography.Text code copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>
              {cert.fingerprint256}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('cert.subject')}>{cert.subject}</Descriptions.Item>
          <Descriptions.Item label={t('cert.issuer')}>{cert.issuer}</Descriptions.Item>
          <Descriptions.Item label={t('cert.validFrom')}>{cert.validFrom}</Descriptions.Item>
          <Descriptions.Item label={t('cert.validTo')}>{cert.validTo}</Descriptions.Item>
        </Descriptions>
      )}
    </Modal>
  )
}
