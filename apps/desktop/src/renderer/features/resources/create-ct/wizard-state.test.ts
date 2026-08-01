import { describe, expect, it } from 'vitest'
import { defaultCreateCtDraft, draftToCreateCtParams } from './wizard-state.ts'

describe('draftToCreateCtParams', () => {
  it('dựng đủ tham số create CT chuẩn', () => {
    const draft = defaultCreateCtDraft('pve1')
    draft.vmid = 250
    draft.hostname = 'web'
    draft.ostemplate = 'local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst'
    draft.password = 's3cret'
    draft.startAfterCreate = true

    const params = draftToCreateCtParams(draft)
    expect(params['node']).toBe('pve1')
    expect(params['vmid']).toBe(250)
    expect(params['ostemplate']).toContain('vztmpl/')
    expect(params['hostname']).toBe('web')
    expect(params['memory']).toBe(512)
    expect(typeof params['memory']).toBe('number')
    expect(params['rootfs']).toBe('local-lvm:8')
    expect(String(params['net0'])).toContain('name=eth0')
    expect(params['unprivileged']).toBe(true)
    expect(params['password']).toBe('s3cret')
    expect(params['start']).toBe(1)
  })

  it('ném khi thiếu ostemplate', () => {
    const draft = defaultCreateCtDraft('pve1')
    draft.vmid = 251
    expect(() => draftToCreateCtParams(draft)).toThrow(/ostemplate/)
  })
})
