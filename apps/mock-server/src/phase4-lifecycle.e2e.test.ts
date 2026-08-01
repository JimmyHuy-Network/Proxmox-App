import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport, isUpid, parseUpid } from '@pve/api'
import { startMockServer } from './index.ts'

/**
 * E2E API cho plan §8 GĐ 4: tạo → start → snapshot → rollback → xóa.
 * Bổ sung cho Playwright `_electron` (UI) — kiểm chứng vòng đời trên mock.
 */

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

let server: Awaited<ReturnType<typeof startMockServer>>
let client: PveClient

beforeAll(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)
  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
  client = new PveClient({ transport, auth, connectionId: 'e2e' })
}, 30_000)

afterAll(async () => {
  await server?.close()
})

async function waitForTask(node: string, upid: string): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    const status = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
    if (status.status === 'stopped') {
      if (status.exitstatus && status.exitstatus !== 'OK') {
        throw new Error(`Task ${upid} thất bại: ${status.exitstatus}`)
      }
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Task ${upid} không xong`)
}

describe('GĐ4 lifecycle E2E (API)', () => {
  it(
    'tạo → start → snapshot (có parent) → rollback → destroy',
    async () => {
      const node = 'pve1'
      const vmid = Number(await client.request('GET', '/cluster/nextid', {}))

      const createUpid = await client.request('POST', '/nodes/{node}/qemu', {
        node,
        vmid,
        name: 'e2e-lifecycle',
        cores: 1,
        memory: '1024',
        scsi0: 'local-lvm:8',
        net0: 'virtio,bridge=vmbr0',
      })
      expect(isUpid(createUpid)).toBe(true)
      await waitForTask(node, createUpid)

      const startUpid = await client.request('POST', '/nodes/{node}/qemu/{vmid}/status/start', {
        node,
        vmid,
      })
      await waitForTask(node, startUpid)
      const status = await client.request('GET', '/nodes/{node}/qemu/{vmid}/status/current', {
        node,
        vmid,
      })
      expect(status.status).toBe('running')

      const snap1 = await client.request('POST', '/nodes/{node}/qemu/{vmid}/snapshot', {
        node,
        vmid,
        snapname: 's1',
        description: 'first',
      })
      expect(parseUpid(snap1).type).toBe('qmsnapshot')
      await waitForTask(node, snap1)

      const snap2 = await client.request('POST', '/nodes/{node}/qemu/{vmid}/snapshot', {
        node,
        vmid,
        snapname: 's2',
        description: 'child',
      })
      await waitForTask(node, snap2)

      const snaps = await client.request('GET', '/nodes/{node}/qemu/{vmid}/snapshot', { node, vmid })
      const s2 = snaps.find((s) => s.name === 's2')
      expect(s2?.parent).toBe('s1')

      const rollback = await client.request(
        'POST',
        '/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/rollback',
        { node, vmid, snapname: 's1' },
      )
      expect(parseUpid(rollback).type).toBe('qmrollback')
      await waitForTask(node, rollback)

      const stop = await client.request('POST', '/nodes/{node}/qemu/{vmid}/status/stop', {
        node,
        vmid,
      })
      await waitForTask(node, stop)

      const destroy = await client.request('DELETE', '/nodes/{node}/qemu/{vmid}', {
        node,
        vmid,
        purge: 1,
      })
      expect(parseUpid(destroy).type).toBe('qmdestroy')
      await waitForTask(node, destroy)

      const list = await client.request('GET', '/nodes/{node}/qemu', { node })
      expect(list.some((g) => g.vmid === vmid)).toBe(false)
    },
    60_000,
  )
})
