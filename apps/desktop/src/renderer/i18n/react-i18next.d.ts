import type { TranslationSchema } from './vi'

/**
 * Cho `t()` biết chính xác những khoá nào tồn tại. Nhờ vậy gõ sai tên khoá là
 * lỗi biên dịch, không phải một chuỗi trống lặng lẽ xuất hiện trên giao diện.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: TranslationSchema
    }
  }
}

export {}
