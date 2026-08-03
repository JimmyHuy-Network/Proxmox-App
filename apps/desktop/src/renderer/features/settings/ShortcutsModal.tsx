import { Button, List, Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

/** Danh sách phím tắt ứng dụng (GĐ 9) — dùng từ Settings và menu Help. */
export function ShortcutsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Modal
      open={open}
      title={t('settings.shortcuts')}
      onCancel={onClose}
      width={520}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <List
        size="small"
        dataSource={[
          { keys: 'Ctrl/Cmd + ,', action: t('nav.settings') },
          { keys: 'Ctrl/Cmd + K', action: t('settings.shortcutSearch') },
          { keys: 'Ctrl/Cmd + 1', action: t('nav.dashboard') },
          { keys: 'Ctrl/Cmd + 2', action: t('nav.connections') },
          { keys: 'Ctrl/Cmd + 3', action: t('nav.access') },
          { keys: 'Ctrl/Cmd + 4', action: t('nav.firewall') },
          { keys: 'Ctrl/Cmd + 5', action: t('nav.datacenter') },
          { keys: 'F5', action: t('settings.shortcutRefresh') },
          { keys: 'Ctrl/Cmd + /', action: t('settings.shortcuts') },
        ]}
        renderItem={(item) => (
          <List.Item>
            <Typography.Text code>{item.keys}</Typography.Text>
            <span>{item.action}</span>
          </List.Item>
        )}
      />
    </Modal>
  )
}
