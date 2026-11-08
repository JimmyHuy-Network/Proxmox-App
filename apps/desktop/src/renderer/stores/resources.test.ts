import { describe, expect, it } from 'vitest'
import { resourcesSignature, useResources } from './resources'

describe('resourcesSignature (GĐ 9 perf)', () => {
  it('publishes changed storage usage and capacity to subscribers', () => {
    const before = [{ id: 'storage/pve1/local', type: 'storage', disk: 10, maxdisk: 100 }]
    const after = [{ ...before[0], disk: 90, maxdisk: 200 }]
    useResources.getState().setResources('storage-regression', before, 1)
    useResources.getState().setResources('storage-regression', after, 2)
    expect(useResources.getState().byConnection['storage-regression']?.resources).toEqual(after)
  })
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
