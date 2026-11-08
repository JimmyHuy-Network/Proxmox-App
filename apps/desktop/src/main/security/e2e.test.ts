import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { e2eSettings } from './e2e.ts'

describe('E2E vault isolation', () => {
  it('ignores the test hook in packaged builds', () => {
    expect(e2eSettings(true, '/profile', 'https://127.0.0.1:8006')).toEqual({
      mockUrl: undefined,
      vaultPath: join('/profile', 'vault.json'),
    })
  })

  it('keeps mock credentials out of the normal vault', () => {
    const normal = e2eSettings(false, '/profile')
    const mock = e2eSettings(false, '/profile', 'https://127.0.0.1:8006')
    expect(mock.vaultPath).toBe(join('/profile', 'e2e', 'vault.json'))
    expect(mock.vaultPath).not.toBe(normal.vaultPath)
    expect(mock.mockUrl).toBeTruthy()
  })

  it.each(['https://cluster.example:8006', 'http://127.0.0.1:8006', 'invalid'])(
    'rejects unsafe mock URL %s',
    (url) => {
      expect(() => e2eSettings(false, '/profile', url)).toThrow()
    },
  )
})
