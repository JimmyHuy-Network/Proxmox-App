import { describe, expect, it } from 'vitest'
import {
  classifyConfigKeys,
  nextDiskKey,
  nextNetKey,
  schemaNameForKey,
  summarizeHardwareValue,
} from './config-keys.ts'

const qemuConfig = {
  name: 'debian-13',
  cores: 2,
  sockets: 1,
  memory: 2048,
  scsi0: 'local-lvm:vm-100-disk-0,size=32G,iothread=1',
  net0: 'virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0,firewall=1',
  boot: 'order=scsi0;net0',
  digest: 'a'.repeat(40),
}

describe('classifyConfigKeys', () => {
  it('chia nhóm và bỏ digest khỏi danh sách', () => {
    const items = classifyConfigKeys(
      {
        ...qemuConfig,
        ide2: 'local:iso/debian.iso,media=cdrom',
        usb0: 'spice,usb3=1',
        audio0: 'device=ich9-intel-hda,driver=spice',
        serial0: 'socket',
        hostpci0: '0000:01:00',
        efidisk0: 'local-lvm:vm-100-disk-1,efitype=4m',
      },
      'qemu',
    )
    expect(items.find((i) => i.key === 'digest')).toBeUndefined()
    expect(items.find((i) => i.key === 'cores')?.group).toBe('cpu')
    expect(items.find((i) => i.key === 'memory')?.group).toBe('memory')
    expect(items.find((i) => i.key === 'scsi0')?.group).toBe('disk')
    expect(items.find((i) => i.key === 'net0')?.group).toBe('net')
    expect(items.find((i) => i.key === 'ide2')?.group).toBe('cdrom')
    expect(items.find((i) => i.key === 'usb0')?.group).toBe('usb')
    expect(items.find((i) => i.key === 'audio0')?.group).toBe('audio')
    expect(items.find((i) => i.key === 'serial0')?.group).toBe('serial')
    expect(items.find((i) => i.key === 'hostpci0')?.group).toBe('pci')
    expect(items.find((i) => i.key === 'efidisk0')?.group).toBe('efi')
    expect(items.find((i) => i.key === 'boot')?.group).toBe('other')
  })

  it('gán đúng schema property string', () => {
    expect(schemaNameForKey('net0', 'qemu')).toBe('qemu.net')
    expect(schemaNameForKey('net0', 'lxc')).toBe('lxc.net')
    expect(schemaNameForKey('scsi0', 'qemu')).toBe('scsi')
    expect(schemaNameForKey('rootfs', 'lxc')).toBe('rootfs')
    expect(schemaNameForKey('mp0', 'lxc')).toBe('mp')
  })

  it('rootfs LXC không removable; net/disk thì có', () => {
    const items = classifyConfigKeys(
      { rootfs: 'local-lvm:vm-200-disk-0,size=8G', net0: 'name=eth0,bridge=vmbr0', mp0: 'local:1,mp=/data' },
      'lxc',
    )
    expect(items.find((i) => i.key === 'rootfs')?.removable).toBe(false)
    expect(items.find((i) => i.key === 'net0')?.removable).toBe(true)
    expect(items.find((i) => i.key === 'mp0')?.removable).toBe(true)
  })
})

describe('next slot helpers', () => {
  it('chọn net/disk trống tiếp theo', () => {
    expect(nextNetKey({ net0: 'x', net1: 'y' })).toBe('net2')
    expect(nextDiskKey({ scsi0: 'x' }, 'scsi')).toBe('scsi1')
    expect(nextDiskKey({}, 'virtio')).toBe('virtio0')
  })
})

describe('summarizeHardwareValue', () => {
  it('tóm tắt net và disk qemu', () => {
    const items = classifyConfigKeys(qemuConfig, 'qemu')
    const net = items.find((i) => i.key === 'net0')!
    const disk = items.find((i) => i.key === 'scsi0')!
    expect(summarizeHardwareValue(net, 'qemu')).toContain('virtio=')
    expect(summarizeHardwareValue(net, 'qemu')).toContain('bridge=vmbr0')
    expect(summarizeHardwareValue(disk, 'qemu')).toContain('32G')
  })
})
