import { describe, expect, it } from 'vitest'
import { defaultCreateVmDraft, draftToCreateParams } from './wizard-state.ts'

describe('draftToCreateParams', () => {
  it('dựng đủ tham số create VM chuẩn', () => {
    const draft = defaultCreateVmDraft('pve1')
    draft.vmid = 150
    draft.name = 'my-vm'
    draft.iso = 'local:iso/debian.iso'
    draft.startAfterCreate = true

    const params = draftToCreateParams(draft)
    expect(params['node']).toBe('pve1')
    expect(params['vmid']).toBe(150)
    expect(params['name']).toBe('my-vm')
    expect(params['memory']).toBe('2048')
    expect(typeof params['memory']).toBe('string')
    expect(params['scsi0']).toContain('local-lvm:32')
    expect(params['scsi0']).toContain('iothread=1')
    expect(String(params['net0'])).toContain('virtio')
    expect(String(params['net0'])).toContain('bridge=vmbr0')
    expect(params['ide2']).toBe('local:iso/debian.iso,media=cdrom')
    expect(params['agent']).toBe('enabled=1')
    expect(params['start']).toBe(1)
    expect(String(params['boot'])).toContain('scsi0')
  })

  it('bỏ ide2 khi không chọn ISO', () => {
    const draft = defaultCreateVmDraft('pve2')
    draft.vmid = 200
    const params = draftToCreateParams(draft)
    expect(params['ide2']).toBeUndefined()
    expect(String(params['boot'])).not.toContain('ide2')
  })
})
