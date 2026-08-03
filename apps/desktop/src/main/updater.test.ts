import { describe, expect, it } from 'vitest'
import { classifyUpdateError } from './updater-errors.ts'

describe('classifyUpdateError', () => {
  it('maps missing publish / feed errors to disabled', () => {
    for (const message of [
      'ENOENT: no such file or directory, open app-update.yml',
      'Cannot check for updates: Error: ERR_UPDATER_NO_PUBLISHED_VERSIONS',
      'Unable to find latest version on GitHub',
      'No published versions on GitHub',
      '404 Not Found latest.yml',
      'HTTP 401 Unauthorized',
      'HTTP 403 Forbidden private repo',
    ]) {
      expect(classifyUpdateError(message)).toEqual({
        state: 'disabled',
        reason: message.slice(0, 200),
      })
    }
  })

  it('keeps unrelated failures as error', () => {
    expect(classifyUpdateError('disk full while writing update')).toEqual({
      state: 'error',
      message: 'disk full while writing update',
    })
  })
})
