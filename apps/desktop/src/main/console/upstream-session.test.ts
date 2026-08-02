import { describe, expect, it } from 'vitest'
import { formatVirtViewerFile } from './upstream-session.ts'

describe('formatVirtViewerFile', () => {
  it('sinh file .vv đúng các khoá virt-viewer', () => {
    const text = formatVirtViewerFile({
      type: 'spice',
      host: 'pve1',
      password: 'secret',
      proxy: 'http://pve1:3128',
      'tls-port': 61000,
    })
    expect(text).toContain('[virt-viewer]')
    expect(text).toContain('type=spice')
    expect(text).toContain('host=pve1')
    expect(text).toContain('password=secret')
    expect(text).toContain('tls-port=61000')
    expect(text).toContain('delete-this-file=1')
  })
})
