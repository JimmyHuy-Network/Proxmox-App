/**
 * Re-export từ `@pve/api` để renderer và main vẫn import qua alias `@shared`
 * (đã cấu hình sẵn trong electron-vite / vitest), trong khi mock-server dùng
 * trực tiếp `@pve/api`.
 */
export {
  TERM_PING,
  decodeTermFrame,
  decodeTermFrameFromString,
  encodeTermData,
  encodeTermResize,
  type TermFrame,
} from '@pve/api'
