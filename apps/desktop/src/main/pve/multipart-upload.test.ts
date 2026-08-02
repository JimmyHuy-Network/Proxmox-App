import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PveClient, TicketAuthProvider, createFetchTransport, isUpid, login } from '@pve/api'
import { startMockServer } from '../../../../mock-server/src/index.ts'
import { uploadMultipart } from './multipart-upload.ts'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

describe('uploadMultipart', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>
  let dir: string

  beforeEach(async () => {
    server = await startMockServer({ port: 0, quiet: true })
    server.mock.setLatency(0, 0)
    dir = await mkdtemp(join(tmpdir(), 'pve-mp-'))
  })

  afterEach(async () => {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('stream 10 MB lên mock, có tiến trình và trả UPID', async () => {
    const filePath = join(dir, 'big.iso')
    const size = 10 * 1024 * 1024
    await writeFile(filePath, Buffer.alloc(size, 0x5a))

    const transport = createFetchTransport({ baseUrl: server.url })
    const ticket = await login(transport, { username: 'root@pam', password: 'x' })
    expect(ticket.status).toBe('ok')
    if (ticket.status !== 'ok') throw new Error('login')

    const url = new URL(server.url)
    const progress: number[] = []
    let last = -1

    const result = await uploadMultipart({
      host: url.hostname,
      port: Number(url.port),
      node: 'pve1',
      storage: 'local',
      content: 'iso',
      filename: 'big.iso',
      filePath,
      headers: {
        Cookie: `PVEAuthCookie=${encodeURIComponent(ticket.session.ticket)}`,
        CSRFPreventionToken: ticket.session.csrfToken,
      },
      allowSelfSigned: true,
      onProgress: (sent, total) => {
        if (sent !== last) {
          progress.push(sent)
          last = sent
        }
        expect(total).toBeGreaterThan(size)
      },
    })

    expect(result.status).toBe(200)
    expect(result.data && isUpid(result.data)).toBe(true)
    expect(progress.length).toBeGreaterThan(3)
    expect(progress.at(-1)).toBeGreaterThanOrEqual(size)

    // Chờ task ghi volume
    const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
    auth.adoptSession(ticket.session)
    const client = new PveClient({ transport, auth })
    const upid = String(result.data)
    const node = upid.split(':')[1] ?? 'pve1'
    for (let i = 0; i < 40; i += 1) {
      const st = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
      if (st.status === 'stopped') break
      await new Promise((r) => setTimeout(r, 100))
    }

    const contents = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
      node: 'pve1',
      storage: 'local',
      content: 'iso',
    })
    expect(contents.some((v) => String(v.volid).includes('big.iso'))).toBe(true)
  }, 30_000)

  it('huỷ giữa chừng không thêm volume', async () => {
    const filePath = join(dir, 'cancel.iso')
    await writeFile(filePath, Buffer.alloc(8 * 1024 * 1024, 0x41))

    const transport = createFetchTransport({ baseUrl: server.url })
    const ticket = await login(transport, { username: 'root@pam', password: 'x' })
    expect(ticket.status).toBe('ok')
    if (ticket.status !== 'ok') throw new Error('login')

    const url = new URL(server.url)
    const ac = new AbortController()

    const uploadPromise = uploadMultipart({
      host: url.hostname,
      port: Number(url.port),
      node: 'pve1',
      storage: 'local',
      content: 'iso',
      filename: 'cancel.iso',
      filePath,
      headers: {
        Cookie: `PVEAuthCookie=${encodeURIComponent(ticket.session.ticket)}`,
        CSRFPreventionToken: ticket.session.csrfToken,
      },
      allowSelfSigned: true,
      signal: ac.signal,
      onProgress: (sent) => {
        if (sent > 512 * 1024) ac.abort()
      },
    })

    await expect(uploadPromise).rejects.toThrow()

    const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
    auth.adoptSession(ticket.session)
    const client = new PveClient({ transport, auth })
    const contents = await client.request('GET', '/nodes/{node}/storage/{storage}/content', {
      node: 'pve1',
      storage: 'local',
      content: 'iso',
    })
    expect(contents.some((v) => String(v.volid).includes('cancel.iso'))).toBe(false)
  }, 20_000)
})
