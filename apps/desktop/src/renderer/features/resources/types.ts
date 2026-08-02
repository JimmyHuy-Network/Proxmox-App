/**
 * Một dòng trong `/cluster/resources`. Trường có mặt hay không tùy vào `type`
 * (node/qemu/lxc/storage/pool/sdn) — Proxmox không tách theo kiểu con, nên mọi
 * trường ngoài `id`/`type` đều tùy chọn.
 */
export interface ClusterResource {
  id: string
  type: string
  node?: string
  name?: string
  status?: string
  vmid?: number
  storage?: string
  plugintype?: string
  content?: string
  shared?: number
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  template?: number
  tags?: string
  lock?: string
}

export function isGuest(r: ClusterResource): boolean {
  return r.type === 'qemu' || r.type === 'lxc'
}
