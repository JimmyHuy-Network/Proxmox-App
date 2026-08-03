/**
 * Playwright `_electron` — GĐ 8: user hạn chế → power mờ; trang Access/Firewall.
 * Chạy từ repo root:
 *   npm run build --workspace=@pve/desktop && \
 *   ELECTRON_E2E=1 xvfb-run -a npx vitest run apps/desktop/electron-e2e/phase8-access.test.ts
 */
import { _electron as electron, expect as pwExpect, type ElectronApplication, type Page } from '@playwright/test'
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

describe.skipIf(!enabled)('Playwright electron phase 8 access caps', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>
  let userData: string
  let app: ElectronApplication
  let page: Page

  beforeAll(async () => {
    server = await startMockServer({ port: 0, quiet: true })
    server.mock.setLatency(0, 0)

    userData = mkdtempSync(join(tmpdir(), 'pve-e2e-p8-'))
    const mockUrl = server.url.replace(/\/$/, '')

    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`, '--disable-dev-shm-usage'],
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        PVE_E2E_MOCK_URL: mockUrl,
        PVE_E2E_USER: 'vanhanh@pve',
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

  it('guest đang chạy: Shutdown/Stop disabled vì thiếu VM.PowerMgmt', async () => {
    // Về dashboard nếu đang ở trang khác
    await page.getByRole('link', { name: /Tổng quan|Dashboard/i }).click()
    await page.waitForTimeout(300)

    // Bảng tổng quan: click hàng debian-13 (VM 100, đang chạy)
    const row = page.locator('.ant-table-row').filter({ hasText: 'debian-13' }).first()
    await row.waitFor({ timeout: 30_000 })
    await row.click()

    const drawer = page.locator('.ant-drawer').filter({ hasText: 'debian-13' }).last()
    await drawer.waitFor({ timeout: 15_000 })

    const shutdown = drawer.getByRole('button', { name: /Tắt máy|Shutdown/i })
    await pwExpect(shutdown).toBeDisabled({ timeout: 10_000 })

    const stop = drawer.getByRole('button', { name: /Buộc dừng|^Stop$/i })
    await pwExpect(stop).toBeDisabled({ timeout: 5_000 })

    // Tooltip: hover parent span (TaskButton bọc button disabled).
    await shutdown.evaluate((el) => {
      const parent = el.parentElement
      if (parent) parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })
    await page.waitForTimeout(400)
    const tip = page.locator('.ant-tooltip:not(.ant-tooltip-hidden)')
    if (await tip.count()) {
      const tipText = (await tip.first().textContent()) ?? ''
      expect(tipText).toMatch(/quyền|permission|denied|tắt/i)
    }

    await drawer.locator('.ant-drawer-close').click()
    await page.locator('.ant-drawer-mask').waitFor({ state: 'hidden', timeout: 10_000 })
  }, 60_000)

  it('trang Access mở; nút thêm user disabled với vanhanh', async () => {
    if (await page.locator('.ant-drawer-mask').isVisible().catch(() => false)) {
      await page.keyboard.press('Escape')
      await page.locator('.ant-drawer-mask').waitFor({ state: 'hidden', timeout: 10_000 })
    }
    await page.getByRole('link', { name: /^Access$/i }).click()
    await page.getByText(/Users|groups|ACL|realms|user@realm|User ID/i).first().waitFor({
      timeout: 15_000,
    })
    const add = page.getByRole('button', { name: /Thêm user|Add user/i })
    await pwExpect(add).toBeDisabled({ timeout: 10_000 })
  }, 60_000)

  it('trang Firewall hiện rules cụm', async () => {
    await page.getByRole('link', { name: /^Firewall$/i }).click()
    await page.getByText(/PVE API|SSH|ACCEPT/i).first().waitFor({ timeout: 15_000 })
  }, 60_000)
})
