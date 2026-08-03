import { useEffect, useState } from 'react'
import { App, Button, Descriptions, Divider, Select, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUpdate } from '../../stores/update'
import type { SupportedLanguage } from '../../i18n'
import { storeLanguage } from '../../i18n/locale'
import { AboutModal } from './AboutModal'
import { ShortcutsModal } from './ShortcutsModal'

/**
 * Trang Cài đặt (GĐ 9): ngôn ngữ, phiên bản, cập nhật, log, phím tắt.
 */
export function SettingsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const status = useUpdate((s) => s.status)
  const refresh = useUpdate((s) => s.refresh)
  const check = useUpdate((s) => s.check)
  const install = useUpdate((s) => s.install)
  const [version, setVersion] = useState<{
    app: string
    electron: string
    chrome?: string
    node?: string
    platform?: string
    packaged?: boolean
  } | null>(null)
  const [logPath, setLogPath] = useState<string>('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  useEffect(() => {
    void refresh()
    void window.pve.app.getVersion().then((res) => {
      if (res.ok && res.data) setVersion(res.data)
    })
    void window.pve.app.getLogPath().then((res) => {
      if (res.ok && res.data) setLogPath(res.data)
    })
  }, [refresh])

  const lang = (i18n.language === 'en' ? 'en' : 'vi') as SupportedLanguage

  const updateLabel = (): string => {
    switch (status.state) {
      case 'idle':
        return t('settings.updateIdle')
      case 'checking':
        return t('settings.updateChecking')
      case 'available':
        return t('settings.updateAvailable', { version: status.version })
      case 'not-available':
        return t('settings.updateCurrent', { version: status.version })
      case 'downloading':
        return t('settings.updateDownloading', { percent: status.percent })
      case 'downloaded':
        return t('settings.updateReady', { version: status.version })
      case 'error':
        return t('settings.updateError', { message: status.message })
      case 'disabled':
        return t('settings.updateDisabled', { reason: status.reason })
      default:
        return '—'
    }
  }

  return (
    <Space direction="vertical" size={20} style={{ width: '100%', maxWidth: 720 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('nav.settings')}
      </Typography.Title>

      <section aria-labelledby="settings-lang">
        <Typography.Title level={5} id="settings-lang">
          {t('settings.language')}
        </Typography.Title>
        <Select
          style={{ width: 220 }}
          value={lang}
          aria-label={t('settings.language')}
          options={[
            { value: 'vi', label: t('settings.langVi') },
            { value: 'en', label: t('settings.langEn') },
          ]}
          onChange={(value) => {
            const next = value as SupportedLanguage
            storeLanguage(next)
            void i18n.changeLanguage(next)
            // Báo Providers đổi antd locale qua custom event.
            window.dispatchEvent(new CustomEvent('pve:locale', { detail: next }))
            message.success(t('settings.languageChanged'))
          }}
        />
      </section>

      <Divider style={{ margin: 0 }} />

      <section aria-labelledby="settings-about">
        <Typography.Title level={5} id="settings-about">
          {t('settings.about')}
        </Typography.Title>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label={t('settings.appVersion')}>
            {version?.app ?? '…'}
          </Descriptions.Item>
          <Descriptions.Item label="Electron">{version?.electron ?? '…'}</Descriptions.Item>
          <Descriptions.Item label="Chrome">{version?.chrome ?? '…'}</Descriptions.Item>
          <Descriptions.Item label="Node">{version?.node ?? '…'}</Descriptions.Item>
          <Descriptions.Item label={t('settings.platform')}>
            {version?.platform ?? '…'}
            {version?.packaged ? ` (${t('settings.packaged')})` : ` (${t('settings.devBuild')})`}
          </Descriptions.Item>
        </Descriptions>
        <Space style={{ marginTop: 12 }}>
          <Button onClick={() => setAboutOpen(true)}>{t('settings.about')}</Button>
          <Button onClick={() => setShortcutsOpen(true)}>{t('settings.shortcuts')}</Button>
        </Space>
      </section>

      <Divider style={{ margin: 0 }} />

      <section aria-labelledby="settings-update">
        <Typography.Title level={5} id="settings-update">
          {t('settings.updates')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {updateLabel()}
        </Typography.Paragraph>
        <Space>
          <Button
            onClick={() => {
              void check().then(() => message.info(t('settings.updateChecked')))
            }}
          >
            {t('settings.checkUpdate')}
          </Button>
          <Button
            type="primary"
            disabled={status.state !== 'downloaded'}
            onClick={() => void install()}
          >
            {t('settings.installUpdate')}
          </Button>
        </Space>
      </section>

      <Divider style={{ margin: 0 }} />

      <section aria-labelledby="settings-logs">
        <Typography.Title level={5} id="settings-logs">
          {t('settings.logs')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" copyable={Boolean(logPath)} style={{ marginBottom: 8 }}>
          {logPath || '…'}
        </Typography.Paragraph>
        <Button
          onClick={() => {
            void window.pve.app.openLogs().then((res) => {
              if (!res.ok) message.error(res.message ?? t('common.error'))
            })
          }}
        >
          {t('settings.openLogs')}
        </Button>
      </section>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} version={version} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </Space>
  )
}
