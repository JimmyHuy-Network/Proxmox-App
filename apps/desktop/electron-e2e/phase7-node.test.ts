/**
 * Playwright `_electron` — GĐ 7 NodeDrawer + Cluster page.
 * Chạy từ repo root:
 *   npm run build --workspace=@pve/desktop && \
 *   ELECTRON_E2E=1 xvfb-run -a npx vitest run apps/desktop/electron-e2e/phase7-node.test.ts
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockServer } from '../../mock-server/src/index.ts'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(here, '..')
const mainEntry = join(desktopRoot, 'out/main/index.js')
const enabled = process.env['ELECTRON_E2E'] === '1' && existsSync(mainEntry)

async function openTab(page: Page, drawer: ReturnType<Page['locator']>, name: RegExp): Promise<void> {
  const tabBtn = drawer.getByRole('tab', { name })
  if (await tabBtn.isVisible().catch(() => false)) {
    await tabBtn.click()
    await page.waitForTimeout(300)
    return
  }
  // Overflow: Ant Design ẩn tab sau nút "more"
  const more = drawer.locator('.ant-tabs-nav-operations button, .ant-tabs-nav-more').first()
  await more.click({ timeout: 5_000 })
  const menuItem = page.locator('.ant-tabs-dropdown:not(.ant-tabs-dropdown-hidden)').getByRole('menuitem', { name })
  if (await menuItem.count()) {
    await menuItem.first().click()
  } else {
    await page.locator('.ant-tabs-dropdown:not(.ant-tabs-dropdown-hidden)').getByText(name).first().click()
  }
  await page.waitForTimeout(300)
}

describe.skipIf(!enabled)('Playwright electron phase 7 node/cluster', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>
  let userData: string
  let app: ElectronApplication
  let page: Page

  beforeAll(async () => {
    server = await startMockServer({ port: 0, quiet: true })
    server.mock.setLatency(0, 0)

    userData = mkdtempSync(join(tmpdir(), 'pve-e2e-p7-'))
    const mockUrl = server.url.replace(/\/$/, '')

    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`, '--disable-dev-shm-usage'],
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        PVE_E2E_MOCK_URL: mockUrl,
        PVE_E2E_USER: 'root@pam',
        PVE_E2E_PASSWORD: 'x',
      },
      timeout: 60_000,
    })

    page = await app.firstWindow({ timeout: 60_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.getByText('pve1', { exact: true }).first().waitFor({ timeout: 60_000 })
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
    'NodeDrawer: mở từ cây + các tab GĐ 7 load dữ liệu',
    async () => {
      await page.locator('.ant-tree').getByText('pve1', { exact: true }).first().click()

      const drawer = page.locator('.ant-drawer').filter({ hasText: 'pve1' }).last()
      await drawer.waitFor({ timeout: 15_000 })
      await drawer.locator('.ant-drawer-title').getByText('pve1').waitFor({ timeout: 5_000 })

      // Overview
      await drawer.getByText('CPU').first().waitFor({ timeout: 15_000 })
      await drawer.getByText(/^PVE$/i).first().waitFor({ timeout: 5_000 })

      await openTab(page, drawer, /Network/i)
      await drawer.getByRole('button', { name: /Apply|Áp dụng/i }).first().waitFor({ timeout: 15_000 })
      await drawer.getByText(/vmbr|eth|bond/i).first().waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /Disks/i)
      await drawer.getByText(/\/dev\//i).first().waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /^DNS$/i)
      await drawer.getByText(/Search domain|DNS 1/i).first().waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /Hosts/i)
      await drawer.locator('textarea').first().waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /^Time$/i)
      await drawer.getByText(/^UTC$/i).first().waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /Updates/i)
      await drawer.getByRole('button', { name: /Apt update/i }).waitFor({ timeout: 15_000 })
      await drawer.getByText(/Có bản cập nhật/i).first().waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /Certificates/i)
      await drawer.getByRole('button', { name: /Order ACME/i }).waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /^Logs$/i)
      await drawer.getByRole('tab', { name: /Syslog/i }).waitFor({ timeout: 15_000 })

      await openTab(page, drawer, /Ceph/i)
      await drawer.getByText(/HEALTH_/i).first().waitFor({ timeout: 15_000 })

      // Đóng drawer (mask chặn click nav nếu còn mở).
      await drawer.locator('.ant-drawer-close').click()
      await page.locator('.ant-drawer-mask').waitFor({ state: 'hidden', timeout: 10_000 })

      expect(true).toBe(true)
    },
    180_000,
  )

  it(
    'Cluster page: nodes corosync + form create/join',
    async () => {
      // Đảm bảo không còn drawer che.
      if (await page.locator('.ant-drawer-mask').isVisible().catch(() => false)) {
        await page.keyboard.press('Escape')
        await page.locator('.ant-drawer-mask').waitFor({ state: 'hidden', timeout: 10_000 })
      }

      await page.getByRole('link', { name: /^Cluster$/i }).click()
      await page.getByText(/Corosync|cấu hình cụm/i).first().waitFor({ timeout: 15_000 })
      await page.locator('.ant-table').getByText('pve1').first().waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: /Tạo cluster/i }).waitFor({ timeout: 5_000 })
      await page.getByRole('button', { name: /Join/i }).first().waitFor({ timeout: 5_000 })
      expect(true).toBe(true)
    },
    60_000,
  )
})
