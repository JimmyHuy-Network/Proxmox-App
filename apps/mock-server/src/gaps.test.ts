import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PveClient, TicketAuthProvider, createFetchTransport } from '@pve/api'
import { FIXTURES } from './context.ts'
import { startMockServer } from './index.ts'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

describe('phase 0–6 gaps', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>
  let client: PveClient

  beforeEach(async () => {
    server = await startMockServer({ port: 0, quiet: true })
    server.mock.setLatency(0, 0)
    const transport = createFetchTransport({ baseUrl: server.url })
    const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
    client = new PveClient({ transport, auth, connectionId: 'gaps-test' })
  })

  afterEach(async () => {
    await server.close()
  })

  it('đăng ký fixture huge', () => {
    expect(FIXTURES).toContain('huge')
  })

  it('GET /cluster/log trả mảng có uid/msg/node', async () => {
    const rows = await client.request('GET', '/cluster/log', { max: 20 })
    expect(rows).toHaveLength(20)
    expect(rows[0]).toMatchObject({
      uid: expect.any(Number),
      msg: expect.any(String),
      node: expect.any(String),
    })
  })

  it('nạp huge: 8 node / 400 guest', async () => {
    server.mock.loadFixture('huge')
    const resources = await client.request('GET', '/cluster/resources', {})
    const nodes = resources.filter((r) => r.type === 'node')
    const guests = resources.filter((r) => r.type === 'qemu' || r.type === 'lxc')
    expect(nodes).toHaveLength(8)
    expect(guests).toHaveLength(400)
  })
})
