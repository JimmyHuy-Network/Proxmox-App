import { safeStorage } from 'electron'

/**
 * Mã hóa credential khi lưu xuống đĩa.
 *
 * Là interface để tách khỏi Electron — vault test được bằng một encryptor giả,
 * không cần dựng cả app Electron chỉ để chạy vitest.
 */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(blob: Buffer): string
}

/**
 * Encryptor thật, dựa trên `safeStorage` của Electron.
 *
 * Trên Windows nó dùng DPAPI: khóa gắn với tài khoản người dùng, nên tệp vault
 * chép sang máy khác hay tài khoản khác sẽ không giải mã được.
 *
 * Giới hạn cần ghi rõ với người dùng: DPAPI bảo vệ trước **người dùng khác** trên
 * máy, KHÔNG bảo vệ trước **tiến trình khác chạy dưới cùng tài khoản**. Đây là mức
 * bảo mật tiêu chuẩn (VS Code, Slack, Chrome đều vậy) — đừng thổi phồng hơn.
 */
export class SafeStorageEncryptor implements Encryptor {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(plain: string): Buffer {
    return safeStorage.encryptString(plain)
  }

  decrypt(blob: Buffer): string {
    return safeStorage.decryptString(blob)
  }
}

/**
 * Encryptor plaintext chỉ dùng khi `PVE_E2E_MOCK_URL` — môi trường CI/headless
 * thường không có libsecret nên `safeStorage` không sẵn sàng.
 */
export class E2ePlainEncryptor implements Encryptor {
  isAvailable(): boolean {
    return true
  }

  encrypt(plain: string): Buffer {
    return Buffer.from(plain, 'utf8')
  }

  decrypt(blob: Buffer): string {
    return blob.toString('utf8')
  }
}
