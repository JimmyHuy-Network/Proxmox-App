#!/usr/bin/env node
/**
 * Sinh lại fixtures/huge.json (8 node / 400 guest) — chạy khi cần chỉnh cấu trúc.
 * Usage: node apps/mock-server/scripts/generate-huge.mjs
 */
/* eslint-disable no-undef */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'huge.json')

const nodes = []
for (let i = 1; i <= 8; i++) {
  nodes.push({
    node: `pve${i}`,
    status: 'online',
    cpu: 0.05 + (i % 5) * 0.02,
    maxcpu: 16,
    mem: 8_000_000_000 + i * 100_000_000,
    maxmem: 64_000_000_000,
    disk: 20_000_000_000,
    maxdisk: 500_000_000_000,
    uptime: 86400 * i,
    level: '',
  })
}

const guests = []
let vmid = 100
for (let n = 1; n <= 8; n++) {
  const node = `pve${n}`
  for (let g = 0; g < 50; g++) {
    const isCt = g % 5 === 0
    const id = vmid++
    const status = g % 7 === 0 ? 'stopped' : 'running'
    const name = isCt ? `ct-${id}` : `vm-${id}`
    const maxmem = isCt ? 2_000_000_000 : 8_000_000_000
    const maxdisk = isCt ? 16_000_000_000 : 32_000_000_000
    guests.push({
      vmid: id,
      name,
      type: isCt ? 'lxc' : 'qemu',
      node,
      status,
      cpu: status === 'running' ? 0.01 + (g % 10) * 0.01 : 0,
      cpus: isCt ? 2 : 4,
      mem: status === 'running' ? 512_000_000 + g * 10_000_000 : 0,
      maxmem,
      disk: maxdisk / 4,
      maxdisk,
      uptime: status === 'running' ? 3600 * (g + 1) : 0,
      template: false,
      ...(g % 11 === 0 ? { tags: 'lab;perf' } : {}),
      config: isCt
        ? {
            hostname: name,
            cores: 2,
            memory: 2048,
            swap: 512,
            ostype: 'debian',
            arch: 'amd64',
            rootfs: `local-lvm:vm-${id}-disk-0,size=16G`,
            net0: 'name=eth0,bridge=vmbr0,ip=dhcp',
            unprivileged: 1,
          }
        : {
            name,
            cores: 2,
            sockets: 1,
            memory: 4096,
            ostype: 'l26',
            scsihw: 'virtio-scsi-single',
            scsi0: `local-lvm:vm-${id}-disk-0,size=32G`,
            net0: `virtio=AA:BB:CC:DD:${String(n).padStart(2, '0')}:${String(g).padStart(2, '0')},bridge=vmbr0`,
            boot: 'order=scsi0',
            agent: 'enabled=1',
          },
      snapshots: [],
    })
  }
}

const fixture = {
  clusterName: 'huge-cluster',
  quorate: true,
  version: { version: '9.2.1', release: '9.2', repoid: 'huge000000000001' },
  nodes,
  guests,
  storages: [
    {
      storage: 'local',
      type: 'dir',
      content: 'iso,vztmpl,backup,snippets',
      shared: false,
      enabled: true,
      total: 107_374_182_400,
      used: 21_474_836_480,
      avail: 85_899_345_920,
      contents: [
        {
          volid: 'local:iso/debian-13.0.0-amd64-netinst.iso',
          format: 'iso',
          size: 681_574_400,
          content: 'iso',
          ctime: 1_750_000_000,
        },
      ],
    },
    {
      storage: 'local-lvm',
      type: 'lvmthin',
      content: 'images,rootdir',
      shared: false,
      enabled: true,
      total: 429_496_729_600,
      used: 193_273_528_320,
      avail: 236_223_201_280,
      contents: [],
    },
    {
      storage: 'nfs-shared',
      type: 'nfs',
      content: 'images,iso,backup',
      shared: true,
      enabled: true,
      total: 1_099_511_627_776,
      used: 53_687_091_200,
      avail: 1_045_824_536_576,
      config: { server: '10.0.0.50', export: '/export/pve', path: '/mnt/pve/nfs-shared' },
      contents: [],
    },
    {
      storage: 'pbs-main',
      type: 'pbs',
      content: 'backup',
      shared: true,
      enabled: true,
      total: 2_199_023_255_552,
      used: 107_374_182_400,
      avail: 2_091_649_073_152,
      config: { server: '10.0.0.60', datastore: 'store1', username: 'root@pam!' },
      contents: [
        {
          volid: 'pbs-main:backup/vm/100/2026-07-28T03:00:02Z',
          format: 'pbs-vm',
          size: 3_221_225_472,
          content: 'backup',
          vmid: 100,
          ctime: 1_753_670_402,
          notes: 'PBS sample',
          encrypted: true,
          verification: 'ok',
        },
      ],
    },
  ],
  backupJobs: [
    {
      id: 'backup-nightly',
      enabled: true,
      schedule: '02:00',
      storage: 'local',
      mode: 'snapshot',
      compress: 'zstd',
      comment: 'Nightly sample on huge cluster',
      all: true,
      'prune-backups': 'keep-last=3,keep-daily=7',
    },
  ],
  users: [{ userid: 'root@pam', enable: true, realm: 'pam', comment: 'Admin' }],
  pools: [{ poolid: 'lab', comment: 'Perf lab' }],
}

writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`Wrote ${out} (${nodes.length} nodes, ${guests.length} guests)`)
