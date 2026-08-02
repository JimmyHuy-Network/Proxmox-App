/**
 * Trạng thái nháp wizard tạo CT (LXC) — 7 bước:
 * General → Template → Disk → CPU → Memory → Network → Confirm
 */

export interface CreateCtDraft {
  step: number
  node: string
  vmid: number | undefined
  hostname: string
  password: string
  ostemplate: string
  ostype: string
  unprivileged: boolean
  rootStorage: string
  rootSizeGb: number
  cores: number
  memoryMiB: number
  swapMiB: number
  netName: string
  netBridge: string
  netIp: string
  netFirewall: boolean
  startAfterCreate: boolean
}

export const CREATE_CT_STEP_COUNT = 7

export const CT_OSTYPE_OPTIONS = [
  { value: 'debian', label: 'Debian' },
  { value: 'ubuntu', label: 'Ubuntu' },
  { value: 'alpine', label: 'Alpine' },
  { value: 'centos', label: 'CentOS' },
  { value: 'fedora', label: 'Fedora' },
  { value: 'archlinux', label: 'Arch Linux' },
  { value: 'unmanaged', label: 'Unmanaged' },
] as const

export function defaultCreateCtDraft(node: string): CreateCtDraft {
  return {
    step: 0,
    node,
    vmid: undefined,
    hostname: '',
    password: '',
    ostemplate: '',
    ostype: 'debian',
    unprivileged: true,
    rootStorage: 'local-lvm',
    rootSizeGb: 8,
    cores: 1,
    memoryMiB: 512,
    swapMiB: 512,
    netName: 'eth0',
    netBridge: 'vmbr0',
    netIp: 'dhcp',
    netFirewall: false,
    startAfterCreate: false,
  }
}

/** Body `POST /nodes/{node}/lxc` — memory/swap/cores là integer; ostemplate bắt buộc. */
export function draftToCreateCtParams(draft: CreateCtDraft): Record<string, unknown> {
  if (draft.vmid === undefined) throw new Error('Thiếu VMID')
  if (!draft.ostemplate.trim()) throw new Error('Thiếu ostemplate')

  const netParts = [
    `name=${draft.netName || 'eth0'}`,
    `bridge=${draft.netBridge}`,
  ]
  if (draft.netIp.trim()) netParts.push(`ip=${draft.netIp.trim()}`)
  if (draft.netFirewall) netParts.push('firewall=1')

  const params: Record<string, unknown> = {
    node: draft.node,
    vmid: draft.vmid,
    ostemplate: draft.ostemplate.trim(),
    hostname: draft.hostname.trim() || `ct-${draft.vmid}`,
    ostype: draft.ostype,
    cores: draft.cores,
    memory: draft.memoryMiB,
    swap: draft.swapMiB,
    rootfs: `${draft.rootStorage}:${draft.rootSizeGb}`,
    net0: netParts.join(','),
    unprivileged: draft.unprivileged,
  }

  if (draft.password.trim()) params['password'] = draft.password
  if (draft.startAfterCreate) params['start'] = 1

  return params
}
