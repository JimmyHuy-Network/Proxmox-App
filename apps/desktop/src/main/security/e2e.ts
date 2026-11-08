import { join } from 'node:path'

/** Test credentials must never share the production vault or packaged runtime. */
export function e2eSettings(isPackaged: boolean, userData: string, mockUrl?: string) {
  if (!mockUrl || isPackaged) {
    return { mockUrl: undefined, vaultPath: join(userData, 'vault.json') }
  }
  const url = new URL(mockUrl)
  if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('PVE_E2E_MOCK_URL must use HTTPS on loopback')
  }
  return { mockUrl: url.toString(), vaultPath: join(userData, 'e2e', 'vault.json') }
}
