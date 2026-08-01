import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AuthMode,
  ConnectionInput,
  ConnectionSummary,
} from '@pve/ipc'
import type { Encryptor } from './encryptor.ts'

/**
 * Kho kết nối nhiều cluster.
 *
 * Cố ý dùng một tệp JSON + `safeStorage` thay vì SQLite. Chỉ có vài chục kết nối,
 * không cần truy vấn SQL, và tránh được hẳn native module (better-sqlite3 phải
 * rebuild theo ABI của Electron — một nguồn phức tạp lớn không đáng cho quy mô này).
 *
 * Phân tách rõ ràng:
 *  - Metadata (host, cổng, tên đăng nhập, vân tay cert) lưu văn bản thường trong JSON.
 *  - Bí mật (mật khẩu, token secret) mã hóa bằng safeStorage rồi lưu base64 trong
 *    cùng tệp. Kể cả khi tệp lộ ra, phần bí mật vẫn được DPAPI bảo vệ.
 *  - Ticket và CSRF token **không bao giờ** chạm đĩa — chúng chỉ sống trong bộ nhớ
 *    của connection pool.
 */

/** Bí mật đã giải mã, chỉ tồn tại trong bộ nhớ. Không bao giờ gửi sang renderer. */
export interface ConnectionSecret {
  password?: string
  tokenId?: string
  tokenSecret?: string
}

interface StoredConnection {
  id: string
  name: string
  host: string
  port: number
  authMode: AuthMode
  username: string
  allowSelfSigned: boolean
  certFingerprint?: string
  certPinnedAt?: string
  /** JSON của ConnectionSecret, đã mã hóa, mã base64. */
  secretBlob?: string
}

interface VaultFile {
  version: 1
  connections: StoredConnection[]
}

export class Vault {
  private readonly filePath: string
  private readonly encryptor: Encryptor
  private data: VaultFile

  constructor(filePath: string, encryptor: Encryptor) {
    this.filePath = filePath
    this.encryptor = encryptor
    this.data = this.load()
  }

  private load(): VaultFile {
    if (!existsSync(this.filePath)) return { version: 1, connections: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as VaultFile
      if (parsed.version !== 1 || !Array.isArray(parsed.connections)) {
        return { version: 1, connections: [] }
      }
      return parsed
    } catch {
      // Tệp hỏng: bắt đầu lại còn hơn để app không khởi động được. Người dùng
      // sẽ phải thêm lại kết nối, nhưng đó là hỏng hiếm gặp.
      return { version: 1, connections: [] }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
  }

  private find(id: string): StoredConnection | undefined {
    return this.data.connections.find((c) => c.id === id)
  }

  private toSummary(conn: StoredConnection): ConnectionSummary {
    return {
      id: conn.id,
      name: conn.name,
      host: conn.host,
      port: conn.port,
      authMode: conn.authMode,
      username: conn.username,
      hasStoredSecret: conn.secretBlob !== undefined,
      certPinned: conn.certFingerprint !== undefined,
      // Đã xác minh trên PVE 9.2.2: API Token mở được console (qua relay trong main).
      // Nên mọi kết nối đều có khả năng mở console, không phụ thuộc loại credential.
      hasConsoleCredential: true,
    }
  }

  list(): ConnectionSummary[] {
    return this.data.connections.map((c) => this.toSummary(c))
  }

  getSummary(id: string): ConnectionSummary | undefined {
    const conn = this.find(id)
    return conn ? this.toSummary(conn) : undefined
  }

  /** Thông tin nội bộ dùng cho connection pool, gồm cả vân tay đã ghim. */
  getMeta(id: string): StoredConnection | undefined {
    return this.find(id)
  }

  /**
   * Giải mã bí mật của một kết nối. CHỈ gọi trong main; không bao giờ đưa kết quả
   * qua IPC. Trả về null nếu không có bí mật lưu sẵn (chế độ hỏi mỗi lần).
   */
  getSecret(id: string): ConnectionSecret | null {
    const conn = this.find(id)
    if (!conn?.secretBlob) return null
    const plain = this.encryptor.decrypt(Buffer.from(conn.secretBlob, 'base64'))
    return JSON.parse(plain) as ConnectionSecret
  }

  upsert(input: ConnectionInput): ConnectionSummary {
    const id = input.id ?? randomUUID()
    const existing = this.find(id)

    const secret: ConnectionSecret = {}
    if (input.authMode === 'ticket') {
      if (input.password) secret.password = input.password
    } else {
      if (input.tokenId) secret.tokenId = input.tokenId
      if (input.tokenSecret) secret.tokenSecret = input.tokenSecret
    }
    const hasNewSecret = Object.keys(secret).length > 0

    const conn: StoredConnection = {
      id,
      name: input.name,
      host: input.host,
      port: input.port,
      authMode: input.authMode,
      username: input.username,
      allowSelfSigned: input.allowSelfSigned,
      // Giữ lại vân tay đã ghim khi chỉ sửa metadata.
      ...(existing?.certFingerprint ? { certFingerprint: existing.certFingerprint } : {}),
      ...(existing?.certPinnedAt ? { certPinnedAt: existing.certPinnedAt } : {}),
    }

    if (hasNewSecret) {
      if (!this.encryptor.isAvailable()) {
        throw new Error('Không mã hóa được credential: safeStorage chưa sẵn sàng')
      }
      conn.secretBlob = this.encryptor.encrypt(JSON.stringify(secret)).toString('base64')
    } else if (existing?.secretBlob && input.id) {
      // Sửa metadata mà không nhập lại bí mật: giữ nguyên bí mật cũ.
      conn.secretBlob = existing.secretBlob
    }

    if (existing) {
      const index = this.data.connections.findIndex((c) => c.id === id)
      this.data.connections[index] = conn
    } else {
      this.data.connections.push(conn)
    }

    this.persist()
    return this.toSummary(conn)
  }

  remove(id: string): boolean {
    const before = this.data.connections.length
    this.data.connections = this.data.connections.filter((c) => c.id !== id)
    if (this.data.connections.length === before) return false
    this.persist()
    return true
  }

  /** Ghim vân tay chứng chỉ sau khi người dùng xác nhận (trust-on-first-use). */
  trustCertificate(id: string, fingerprint256: string, at: string): boolean {
    const conn = this.find(id)
    if (!conn) return false
    conn.certFingerprint = fingerprint256
    conn.certPinnedAt = at
    conn.allowSelfSigned = true
    this.persist()
    return true
  }

  /** Xóa vân tay đã ghim, buộc xác minh lại (ví dụ khi vân tay đổi). */
  clearCertificate(id: string): void {
    const conn = this.find(id)
    if (!conn) return
    delete conn.certFingerprint
    delete conn.certPinnedAt
    this.persist()
  }
}
