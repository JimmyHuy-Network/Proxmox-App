import { ipcMain } from 'electron'
import { IpcChannel, type ConnectionInput } from '@pve/ipc'
import type { Vault } from '../security/vault.ts'
import type { ConnectionPool } from '../pve/connection-pool.ts'

/**
 * Kênh quản lý kho kết nối và vòng đời xác thực.
 *
 * Mọi thao tác có thể thay đổi cấu hình (thêm/sửa/xóa kết nối, ghim chứng chỉ) đều
 * đi qua đây. Bí mật chỉ đi một chiều renderer → main; chiều ngược lại chỉ có
 * `ConnectionSummary` không chứa credential.
 */

type VaultReply =
  | { ok: true; data: unknown }
  | { ok: false; message: string }

function parseInput(raw: unknown): ConnectionInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r['name'] !== 'string') return null
  if (typeof r['host'] !== 'string') return null
  if (typeof r['port'] !== 'number') return null
  if (r['authMode'] !== 'ticket' && r['authMode'] !== 'token') return null
  if (typeof r['username'] !== 'string') return null

  const input: ConnectionInput = {
    name: r['name'],
    host: r['host'],
    port: r['port'],
    authMode: r['authMode'],
    username: r['username'],
    allowSelfSigned: r['allowSelfSigned'] === true,
  }
  if (typeof r['id'] === 'string') input.id = r['id']
  if (typeof r['password'] === 'string') input.password = r['password']
  if (typeof r['tokenId'] === 'string') input.tokenId = r['tokenId']
  if (typeof r['tokenSecret'] === 'string') input.tokenSecret = r['tokenSecret']
  return input
}

export function registerVaultHandlers(vault: Vault, pool: ConnectionPool): void {
  ipcMain.handle(IpcChannel.Vault, async (_event, raw: unknown): Promise<VaultReply> => {
    if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'Lệnh không hợp lệ' }
    const cmd = raw as Record<string, unknown>
    const action = cmd['action']

    try {
      switch (action) {
        case 'list':
          return { ok: true, data: vault.list() }

        case 'upsert': {
          const input = parseInput(cmd['input'])
          if (!input) return { ok: false, message: 'Dữ liệu kết nối không hợp lệ' }
          return { ok: true, data: vault.upsert(input) }
        }

        case 'remove': {
          const id = cmd['id']
          if (typeof id !== 'string') return { ok: false, message: 'Thiếu id' }
          pool.close(id)
          return { ok: true, data: vault.remove(id) }
        }

        case 'test': {
          const input = parseInput(cmd['input'])
          if (!input) return { ok: false, message: 'Dữ liệu kết nối không hợp lệ' }
          return { ok: true, data: await pool.testConnection(input) }
        }

        case 'connect': {
          const id = cmd['id']
          if (typeof id !== 'string') return { ok: false, message: 'Thiếu id' }
          return { ok: true, data: await pool.connect(id) }
        }

        case 'completeTfa': {
          const id = cmd['id']
          const code = cmd['code']
          if (typeof id !== 'string' || typeof code !== 'string') {
            return { ok: false, message: 'Thiếu id hoặc mã OTP' }
          }
          return { ok: true, data: await pool.completeTfa(id, code) }
        }

        case 'trustCert': {
          const id = cmd['id']
          const fingerprint = cmd['fingerprint']
          if (typeof id !== 'string' || typeof fingerprint !== 'string') {
            return { ok: false, message: 'Thiếu id hoặc vân tay' }
          }
          return { ok: true, data: await pool.trustCertAndConnect(id, fingerprint) }
        }

        case 'disconnect': {
          const id = cmd['id']
          if (typeof id !== 'string') return { ok: false, message: 'Thiếu id' }
          pool.close(id)
          return { ok: true, data: null }
        }

        default:
          return { ok: false, message: `Hành động không hỗ trợ: ${String(action)}` }
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Lỗi không rõ' }
    }
  })
}
