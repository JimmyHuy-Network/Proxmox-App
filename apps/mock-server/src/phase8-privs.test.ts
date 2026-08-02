import { describe, expect, it } from 'vitest'
import {
  BUILTIN_ROLES,
  SEED_ACLS,
  capsFromPrivs,
  computeEffectivePrivs,
} from './state/phase8.ts'

describe('phase8 privilege helpers', () => {
  it('root luôn có VM.PowerMgmt', () => {
    const privs = computeEffectivePrivs(SEED_ACLS, BUILTIN_ROLES, 'root@pam', '/', [])
    expect(privs.has('VM.PowerMgmt')).toBe(true)
    const caps = capsFromPrivs(privs)
    expect(caps.vms?.['VM.PowerMgmt']).toBe(1)
  })

  it('vanhanh@pve (operators) chỉ audit — không PowerMgmt', () => {
    const privs = computeEffectivePrivs(SEED_ACLS, BUILTIN_ROLES, 'vanhanh@pve', '/vms/100', [
      'operators',
    ])
    expect(privs.has('VM.Audit')).toBe(true)
    expect(privs.has('Sys.Audit')).toBe(true)
    expect(privs.has('VM.PowerMgmt')).toBe(false)
    expect(privs.has('Permissions.Modify')).toBe(false)
  })
})
