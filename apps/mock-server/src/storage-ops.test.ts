import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import { PveClient, TicketAuthProvider, createFetchTransport, login } from '@pve/api'
import { startMockServer } from './index.ts'

/**
 * Kiểm chứng storage giai đoạn 6: content CRUD, upload multipart, download-url,
 * vzdump, backup jobs.
 */

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

let server: Awaited<ReturnType<typeof startMockServer>>
let client: PveClient

async function waitForTask(upid: string, timeoutMs = 20_000): Promise<void> {
  const node = upid.split(':')[1] ?? 'pve1'
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
    if (status.status === 'stopped') {
      expect(status.exitstatus).toBe('OK')
      return
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`task ${upid} không xong trong ${timeoutMs}ms`)
}

beforeEach(async () => {
  server = await startMockServer({ port: 0, quiet: true })
  server.mock.setLatency(0, 0)
  const transport = createFetchTransport({ baseUrl: server.url })
  const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
  client = new PveClient({ transport, auth, connectionId: 'storage-test' })
})

afterEach(async () => {
  await server.close()
})

describe('storage ops', () => {
  it('liệt kê thêm nfs-backup và pbs-lab', async () => {
    const list = await client.request('GET', '/storage', {})
    const ids = list.map((s) => s.storage).sort()
    expect(ids).toContain('nfs-backup')
    expect(ids).toContain('pbs-lab')
  })

  it('xóa volume content (imgdel UPID)', async () => {
    const upid = await client.request('DELETE', '/nodes/{node}/storage/{storage}/content/{volume}', {
      node: 'pve1',
      storage: 'local',
      volume: 'local:iso/debian-13.0.0-amd64-netinst.iso',
    })
    expect(String(upid)).toMatch(/^UPID:/)
    await waitForTask(String(upid))
    const contents = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
      node: 'pve1',
      storage: 'local',
      content: 'iso',
    })
    expect(contents).toHaveLength(0)
  })

  it('cập nhật notes / protected', async () => {
    await client.request('PUT', '/nodes/{node}/storage/{storage}/content/{volume}', {
      node: 'pve1',
      storage: 'local',
      volume: 'local:backup/vzdump-qemu-100-2026_07_28-03_00_02.vma.zst',
      notes: 'giữ lại',
      protected: true,
    })
    const info = await client.request('GET', '/nodes/{node}/storage/{storage}/content/{volume}', {
      node: 'pve1',
      storage: 'local',
      volume: 'local:backup/vzdump-qemu-100-2026_07_28-03_00_02.vma.zst',
    })
    expect(info.notes).toBe('giữ lại')
    expect(info.protected).toBeTruthy()
  })

  it('upload multipart thêm ISO vào content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pve-upload-'))
    const filePath = join(dir, 'test-upload.iso')
    const payload = Buffer.alloc(1024 * 256, 0x61)
    await writeFile(filePath, payload)

    const transport = createFetchTransport({ baseUrl: server.url })
    const ticket = await login(transport, { username: 'root@pam', password: 'x' })
    expect(ticket.status).toBe('ok')
    if (ticket.status !== 'ok') throw new Error('login')

    const boundary = '----PveBoundary' + Date.now()
    const fileBuf = await readFile(filePath)
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="content"\r\n\r\niso\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="filename"; filename="test-upload.iso"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      fileBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const upid = await new Promise<string>((resolve, reject) => {
      const url = new URL(server.url)
      const req = httpsRequest(
        {
          host: url.hostname,
          port: Number(url.port),
          method: 'POST',
          path: '/api2/json/nodes/pve1/storage/local/upload',
          rejectUnauthorized: false,
          headers: {
            Cookie: `PVEAuthCookie=${encodeURIComponent(ticket.session.ticket)}`,
            CSRFPreventionToken: ticket.session.csrfToken,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            try {
              const json = JSON.parse(text) as { data?: string; message?: string; errors?: unknown }
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(JSON.stringify(json)))
                return
              }
              resolve(String(json.data))
            } catch (e) {
              reject(e)
            }
          })
        },
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    expect(upid).toMatch(/^UPID:/)
    await waitForTask(upid)

    const contents = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
      node: 'pve1',
      storage: 'local',
      content: 'iso',
    })
    expect(contents.some((v) => String(v.volid).includes('test-upload.iso'))).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('download-url tạo volume qua task', async () => {
    const upid = await client.request('POST', '/nodes/{node}/storage/{storage}/download-url', {
      node: 'pve1',
      storage: 'local',
      content: 'iso',
      filename: 'from-url.iso',
      url: 'https://example.com/from-url.iso',
    })
    expect(String(upid)).toMatch(/^UPID:/)
    await waitForTask(String(upid))
    const contents = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
      node: 'pve1',
      storage: 'local',
      content: 'iso',
    })
    expect(contents.some((v) => String(v.volid).includes('from-url.iso'))).toBe(true)
  })

  it(
    'vzdump thêm backup vào storage',
    async () => {
      const upid = await client.request('POST', '/nodes/{node}/vzdump', {
        node: 'pve1',
        vmid: '100',
        storage: 'local',
        compress: 'zstd',
        mode: 'snapshot',
      })
      expect(String(upid)).toMatch(/^UPID:/)
      await waitForTask(String(upid), 25_000)
      const backups = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
        node: 'pve1',
        storage: 'local',
        content: 'backup',
      })
      expect(
        backups.some((v) => Number(v.vmid) === 100 && String(v.volid).includes('vzdump-qemu-100')),
      ).toBe(true)
    },
    30_000,
  )

  it('backup job CRUD', async () => {
    await client.request('POST', '/cluster/backup', {
      id: 'job-test',
      schedule: '03:00',
      storage: 'local',
      mode: 'snapshot',
      compress: 'zstd',
      vmid: '102',
      enabled: true,
    })
    const list = await client.request('GET', '/cluster/backup', {})
    expect(list.some((j) => j.id === 'job-test')).toBe(true)

    await client.request('PUT', '/cluster/backup/{id}', {
      id: 'job-test',
      enabled: false,
      comment: 'tạm tắt',
    })
    const job = await client.request('GET', '/cluster/backup/{id}', { id: 'job-test' })
    expect(job.enabled).toBeFalsy()
    expect(job.comment).toBe('tạm tắt')

    await client.request('DELETE', '/cluster/backup/{id}', { id: 'job-test' })
    const after = await client.request('GET', '/cluster/backup', {})
    expect(after.some((j) => j.id === 'job-test')).toBe(false)
  })

  it('tạo / xóa storage config', async () => {
    await client.request('POST', '/storage', {
      storage: 'dir-extra',
      type: 'dir',
      path: '/mnt/extra',
      content: 'iso,backup',
    })
    const created = await client.request('GET', '/storage/{storage}', { storage: 'dir-extra' })
    expect(created.type).toBe('dir')

    await client.request('DELETE', '/storage/{storage}', { storage: 'dir-extra' })
    const list = await client.request('GET', '/storage', {})
    expect(list.some((s) => s.storage === 'dir-extra')).toBe(false)
  })
})
