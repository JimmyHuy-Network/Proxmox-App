import enUS from 'antd/locale/en_US'
import viVN from 'antd/locale/vi_VN'
import type { Locale } from 'antd/es/locale'
import type { SupportedLanguage } from '../i18n'

const LANG_KEY = 'pve.lang'

export function readStoredLanguage(): SupportedLanguage {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return v === 'en' ? 'en' : 'vi'
  } catch {
    return 'vi'
  }
}

export function storeLanguage(lang: SupportedLanguage): void {
  localStorage.setItem(LANG_KEY, lang)
}

export function antdLocaleFor(lang: SupportedLanguage): Locale {
  return lang === 'en' ? enUS : viVN
}
