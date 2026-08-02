import { describe, expect, it } from 'vitest'
import { resourcesSignature } from './resources'

describe('resourcesSignature (GĐ 9 perf)', () => {
  it('cùng dữ liệu → cùng chữ ký', () => {
    const a = [
      { id: 'qemu/100', type: 'qemu', status: 'running', node: 'pve1', vmid: 100, name: 'a', cpu: 0.1 },
    ]
    const b = [
      { id: 'qemu/100', type: 'qemu', status: 'running', node: 'pve1', vmid: 100, name: 'a', cpu: 0.1 },
    ]
    expect(resourcesSignature(a)).toBe(resourcesSignature(b))
  })

  it('đổi status → chữ ký khác', () => {
    const a = [{ id: 'qemu/100', type: 'qemu', status: 'running', vmid: 100 }]
    const b = [{ id: 'qemu/100', type: 'qemu', status: 'stopped', vmid: 100 }]
    expect(resourcesSignature(a)).not.toBe(resourcesSignature(b))
  })
})
