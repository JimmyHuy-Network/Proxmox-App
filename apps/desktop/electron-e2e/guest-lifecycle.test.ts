/**
 * Playwright `_electron` — plan.md §8 GĐ 4.
 * Chạy: `npm run test:electron-e2e --workspace=@pve/desktop`
 * (bỏ qua mặc định nếu chưa `ELECTRON_E2E=1` hoặc chưa build `out/main`).
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PveClient, TicketAuthProvider, createFetchTransport, isUpid } from '@pve/api'
import { startMockServer } from '../../mock-server/src/index.ts'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(here, '..')
const mainEntry = join(desktopRoot, 'out/main/index.js')
const enabled = process.env['ELECTRON_E2E'] === '1' && existsSync(mainEntry)

describe.skipIf(!enabled)('Playwright electron guest lifecycle', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>
  let client: PveClient
  let userData: string
  let app: ElectronApplication
  let page: Page
  let vmid: number

  async function waitForTask(node: string, upid: string): Promise<void> {
    for (let i = 0; i < 120; i += 1) {
      const status = await client.request('GET', '/nodes/{node}/tasks/{upid}/status', { node, upid })
      if (status.status === 'stopped') return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`Task ${upid} không xong`)
  }

  beforeAll(async () => {
    server = await startMockServer({ port: 0, quiet: true })
    server.mock.setLatency(0, 0)
    const transport = createFetchTransport({ baseUrl: server.url })
    const auth = new TicketAuthProvider(transport, { username: 'root@pam', password: 'x' })
    client = new PveClient({ transport, auth, connectionId: 'pw' })

    vmid = Number(await client.request('GET', '/cluster/nextid', {}))
    const createUpid = await client.request('POST', '/nodes/{node}/qemu', {
      node: 'pve1',
      vmid,
      name: `pw-life-${vmid}`,
      cores: 1,
      memory: '512',
      scsi0: 'local-lvm:4',
    })
    expect(isUpid(createUpid)).toBe(true)
    await waitForTask('pve1', createUpid)

    userData = mkdtempSync(join(tmpdir(), 'pve-e2e-'))
    const mockUrl = server.url.replace(/\/$/, '')

    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        PVE_E2E_MOCK_URL: mockUrl,
      },
      timeout: 60_000,
    })

    page = await app.firstWindow({ timeout: 60_000 })
    await page.waitForLoadState('domcontentloaded')
  }, 120_000)

  afterAll(async () => {
    await app?.close().catch(() => undefined)
    await server?.close()
    try {
      rmSync(userData, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it(
    'UI: thấy guest → start → snapshot → rollback → destroy',
    async () => {
      await page.getByText(`pw-life-${vmid}`).first().waitFor({ timeout: 60_000 })
      await page.getByText(`pw-life-${vmid}`).first().click()

      await page.getByRole('button', { name: /Khởi động|Start/i }).first().click()
      await page.getByText(/Đang chạy|Running/i).first().waitFor({ timeout: 60_000 })

      await page.getByRole('tab', { name: /Snapshot/i }).click()
      const snapInput = page.locator('.ant-drawer-body .ant-card input').first()
      await snapInput.fill('pw-snap')
      await page.getByRole('button', { name: /Tạo snapshot|Create snapshot/i }).click()
      await page.getByText('pw-snap').first().waitFor({ timeout: 45_000 })

      await page.getByRole('button', { name: /Rollback/i }).first().click()
      const ok = page.getByRole('button', { name: /Đồng ý/i }).last()
      await ok.waitFor({ timeout: 5_000 })
      await ok.click()

      await page.getByRole('tab', { name: /Tổng quan|Overview/i }).click()
      await page.getByRole('button', { name: /Buộc dừng|Stop/i }).first().click()
      const confirmStop = page.getByRole('button', { name: /Đồng ý/i }).last()
      await confirmStop.waitFor({ timeout: 5_000 })
      await confirmStop.click()
      await page.getByText(/Đã dừng|Stopped/i).first().waitFor({ timeout: 60_000 })

      await page.getByRole('button', { name: /^Xóa$|^Destroy$/i }).first().click()
      const confirmDestroy = page.getByRole('button', { name: /Đồng ý/i }).last()
      await confirmDestroy.waitFor({ timeout: 5_000 })
      await confirmDestroy.click()

      await page.getByText(`pw-life-${vmid}`).first().waitFor({ state: 'detached', timeout: 90_000 })
    },
    240_000,
  )
})
