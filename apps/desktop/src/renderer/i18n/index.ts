import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { vi } from './vi'
import { en } from './en'

export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

void i18n.use(initReactI18next).init({
  resources: {
    vi: { translation: vi },
    en: { translation: en },
  },
  lng: 'vi',
  fallbackLng: 'vi',
  interpolation: {
    // React đã tự thoát nội dung khi render, thoát thêm lần nữa sẽ hỏng dấu tiếng Việt
    // trong một số trường hợp và không thêm an toàn gì.
    escapeValue: false,
  },
})

export default i18n
