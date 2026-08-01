/**
 * Trạng thái nháp của wizard tạo VM (8 bước chuẩn Proxmox).
 * Form từng bước ghi vào object này; Confirm dựng body POST từ đây.
 */

export interface CreateVmDraft {
  /** Bước hiện tại 0..7 */
  step: number
  // General
  node: string
  vmid: number | undefined
  name: string
  // OS
  ostype: string
  iso: string
  // System
  scsihw: string
  bios: 'seabios' | 'ovmf'
  agent: boolean
  // Disks
  diskStorage: string
  diskSizeGb: number
  diskBus: 'scsi' | 'virtio' | 'ide' | 'sata'
  diskIoThread: boolean
  // CPU
  cores: number
  sockets: number
  // Memory
  memoryMiB: number
  // Network
  netModel: string
  netBridge: string
  netFirewall: boolean
  netMac: string
  // Confirm
  startAfterCreate: boolean
}

export const CREATE_VM_STEP_COUNT = 8

export const OSTYPE_OPTIONS = [
  { value: 'l26', label: 'Linux 6.x/5.x/4.x' },
  { value: 'l24', label: 'Linux 2.4' },
  { value: 'win11', label: 'Windows 11 / 2022/2025' },
  { value: 'win10', label: 'Windows 10 / 2016/2019' },
  { value: 'w2k8', label: 'Windows 2008' },
  { value: 'other', label: 'Other' },
] as const

export const SCSIHW_OPTIONS = [
  { value: 'virtio-scsi-single', label: 'VirtIO SCSI single' },
  { value: 'virtio-scsi-pci', label: 'VirtIO SCSI' },
  { value: 'lsi', label: 'LSI 53C895A' },
  { value: 'megasas', label: 'MegaRAID SAS' },
] as const

export function defaultCreateVmDraft(node: string): CreateVmDraft {
  return {
    step: 0,
    node,
    vmid: undefined,
    name: '',
    ostype: 'l26',
    iso: '',
    scsihw: 'virtio-scsi-single',
    bios: 'seabios',
    agent: true,
    diskStorage: 'local-lvm',
    diskSizeGb: 32,
    diskBus: 'scsi',
    diskIoThread: true,
    cores: 2,
    sockets: 1,
    memoryMiB: 2048,
    netModel: 'virtio',
    netBridge: 'vmbr0',
    netFirewall: true,
    netMac: '',
    startAfterCreate: false,
  }
}

/**
 * Dựng body `POST /nodes/{node}/qemu` từ draft.
 * QEMU `memory` phải là chuỗi (schema `t:"s"`).
 */
export function draftToCreateParams(draft: CreateVmDraft): Record<string, unknown> {
  if (draft.vmid === undefined) throw new Error('Thiếu VMID')

  const diskKey = `${draft.diskBus}0`
  const diskValue =
    draft.diskBus === 'scsi' || draft.diskBus === 'virtio'
      ? `${draft.diskStorage}:${draft.diskSizeGb}${draft.diskIoThread ? ',iothread=1' : ''}`
      : `${draft.diskStorage}:${draft.diskSizeGb}`

  const netParts = [`${draft.netModel}${draft.netMac ? `=${draft.netMac}` : ''}`, `bridge=${draft.netBridge}`]
  if (draft.netFirewall) netParts.push('firewall=1')

  const params: Record<string, unknown> = {
    node: draft.node,
    vmid: draft.vmid,
    name: draft.name.trim() || `vm-${draft.vmid}`,
    ostype: draft.ostype,
    scsihw: draft.scsihw,
    bios: draft.bios,
    cores: draft.cores,
    sockets: draft.sockets,
    memory: String(draft.memoryMiB),
    [diskKey]: diskValue,
    net0: netParts.join(','),
  }

  if (draft.agent) params['agent'] = 'enabled=1'
  if (draft.iso.trim()) params['ide2'] = `${draft.iso.trim()},media=cdrom`
  if (draft.startAfterCreate) params['start'] = 1

  // Boot: đĩa trước, ISO sau nếu có
  const bootOrder = draft.iso.trim() ? `${diskKey};ide2;net0` : `${diskKey};net0`
  params['boot'] = `order=${bootOrder}`

  return params
}
