import { pveRequest } from '../../../lib/pve'

/**
 * PUT một phần config guest kèm `digest` (optimistic concurrency của Proxmox).
 * Truyền `delete` để gỡ khóa (CSV), khớp tham số API thật.
 */
export async function putGuestConfig(
  connectionId: string,
  node: string,
  type: 'qemu' | 'lxc',
  vmid: number,
  patch: Record<string, unknown>,
  digest: string | undefined,
): Promise<void> {
  const path = `/nodes/{node}/${type}/{vmid}/config`
  await pveRequest(connectionId, 'PUT', path, {
    node,
    vmid,
    ...patch,
    ...(digest ? { digest } : {}),
  })
}
