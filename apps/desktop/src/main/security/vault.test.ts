import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Encryptor } from './encryptor.ts'
import { Vault } from './vault.ts'

/**
 * Encryptor giả cho test: XOR + base64, không phải mã hóa thật nhưng đủ để kiểm
 * rằng bí mật KHÔNG nằm dạng văn bản thường trong tệp, và khứ hồi được.
 */
class FakeEncryptor implements Encryptor {
  available = true
  isAvailable(): boolean {
    return this.available
  }
  encrypt(plain: string): Buffer {
    const buf = Buffer.from(plain, 'utf8')
    return Buffer.from(buf.map((b) => b ^ 0x5a))
  }
  decrypt(blob: Buffer): string {
    return Buffer.from(blob.map((b) => b ^ 0x5a)).toString('utf8')
  }
}

let dir: string
let vaultPath: string
let enc: FakeEncryptor

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pve-vault-'))
  vaultPath = join(dir, 'vault.json')
  enc = new FakeEncryptor()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Vault', () => {
  it('bắt đầu rỗng khi chưa có tệp', () => {
    const vault = new Vault(vaultPath, enc)
    expect(vault.list()).toEqual([])
  })

  it('thêm kết nối ticket và trả về summary không lộ bí mật', () => {
    const vault = new Vault(vaultPath, enc)
    const summary = vault.upsert({
      name: 'Lab',
      host: '192.168.1.10',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'huy123456',
      allowSelfSigned: true,
    })

    expect(summary.name).toBe('Lab')
    expect(summary.hasStoredSecret).toBe(true)
    expect(summary.certPinned).toBe(false)
    // Summary tuyệt đối không được chứa mật khẩu.
    expect(JSON.stringify(summary)).not.toContain('huy123456')
  })

  it('không ghi mật khẩu dạng văn bản thường xuống tệp', () => {
    const vault = new Vault(vaultPath, enc)
    vault.upsert({
      name: 'Lab',
      host: 'h',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'sieu-bi-mat-123',
      allowSelfSigned: true,
    })

    const raw = readFileSync(vaultPath, 'utf8')
    expect(raw).not.toContain('sieu-bi-mat-123')
    expect(raw).toContain('secretBlob')
  })

  it('giải mã lại được bí mật (chỉ trong main)', () => {
    const vault = new Vault(vaultPath, enc)
    const { id } = vault.upsert({
      name: 'Lab',
      host: 'h',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'matkhau',
      allowSelfSigned: true,
    })

    expect(vault.getSecret(id)).toEqual({ password: 'matkhau' })
  })

  it('lưu token với id và secret riêng', () => {
    const vault = new Vault(vaultPath, enc)
    const { id } = vault.upsert({
      name: 'Token',
      host: 'h',
      port: 8006,
      authMode: 'token',
      username: 'root@pam',
      tokenId: 'automation',
      tokenSecret: 'uuid-secret',
      allowSelfSigned: true,
    })

    expect(vault.getSecret(id)).toEqual({ tokenId: 'automation', tokenSecret: 'uuid-secret' })
  })

  it('bền vững qua lần nạp lại', () => {
    const v1 = new Vault(vaultPath, enc)
    const { id } = v1.upsert({
      name: 'Lab',
      host: 'h',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'p',
      allowSelfSigned: true,
    })

    const v2 = new Vault(vaultPath, enc)
    expect(v2.list()).toHaveLength(1)
    expect(v2.getSecret(id)).toEqual({ password: 'p' })
  })

  it('sửa metadata mà không nhập lại mật khẩu thì giữ nguyên bí mật', () => {
    const vault = new Vault(vaultPath, enc)
    const { id } = vault.upsert({
      name: 'Lab',
      host: 'h',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      password: 'giu-nguyen',
      allowSelfSigned: true,
    })

    vault.upsert({
      id,
      name: 'Lab đổi tên',
      host: 'h2',
      port: 8007,
      authMode: 'ticket',
      username: 'root@pam',
      allowSelfSigned: true,
    })

    const summary = vault.getSummary(id)
    expect(summary?.name).toBe('Lab đổi tên')
    expect(summary?.host).toBe('h2')
    expect(summary?.hasStoredSecret).toBe(true)
    expect(vault.getSecret(id)).toEqual({ password: 'giu-nguyen' })
  })

  it('chế độ không lưu mật khẩu: hasStoredSecret là false', () => {
    const vault = new Vault(vaultPath, enc)
    const summary = vault.upsert({
      name: 'Hỏi mỗi lần',
      host: 'h',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      allowSelfSigned: true,
    })
    expect(summary.hasStoredSecret).toBe(false)
    expect(vault.getSecret(summary.id)).toBeNull()
  })

  it('ghim và xóa vân tay chứng chỉ', () => {
    const vault = new Vault(vaultPath, enc)
    const { id } = vault.upsert({
      name: 'Lab',
      host: 'h',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      allowSelfSigned: false,
    })

    expect(vault.getSummary(id)?.certPinned).toBe(false)
    vault.trustCertificate(id, 'AA:BB:CC', '2026-08-01T00:00:00Z')
    expect(vault.getSummary(id)?.certPinned).toBe(true)
    expect(vault.getMeta(id)?.certFingerprint).toBe('AA:BB:CC')

    vault.clearCertificate(id)
    expect(vault.getSummary(id)?.certPinned).toBe(false)
  })

  it('xóa kết nối', () => {
    const vault = new Vault(vaultPath, enc)
    const { id } = vault.upsert({
      name: 'Lab',
      host: 'h',
      port: 8006,
      authMode: 'ticket',
      username: 'root@pam',
      allowSelfSigned: true,
    })
    expect(vault.remove(id)).toBe(true)
    expect(vault.list()).toEqual([])
    expect(vault.remove(id)).toBe(false)
  })

  it('báo lỗi khi safeStorage không sẵn sàng mà cần lưu bí mật', () => {
    enc.available = false
    const vault = new Vault(vaultPath, enc)
    expect(() =>
      vault.upsert({
        name: 'Lab',
        host: 'h',
        port: 8006,
        authMode: 'ticket',
        username: 'root@pam',
        password: 'p',
        allowSelfSigned: true,
      }),
    ).toThrow(/safeStorage/)
  })
})
