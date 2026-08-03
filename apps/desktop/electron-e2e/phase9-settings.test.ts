/**
 * Playwright `_electron` — GĐ 9 Settings + shortcuts smoke.
 */
import { _electron as electron, expect as pwExpect, type ElectronApplication, type Page } from '@playwright/test'
import { afterAll, beforeAll, describe, it } from 'vitest'
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

describe.skipIf(!enabled)('Playwright electron phase 9 settings', () => {
  let server: Awaited<ReturnType<typeof startMockServer>>
  let userData: string
  let app: ElectronApplication
  let page: Page

  beforeAll(async () => {
    server = await startMockServer({ port: 0, quiet: true })
    server.mock.setLatency(0, 0)
    userData = mkdtempSync(join(tmpdir(), 'pve-e2e-p9-'))
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        PVE_E2E_MOCK_URL: server.url.replace(/\/$/, ''),
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

  it('trang Settings hiện phiên bản + cập nhật disabled (dev)', async () => {
    await page.getByRole('link', { name: /Cài đặt|Settings/i }).click()
    await page.getByText(/Phiên bản app|App version/i).first().waitFor({ timeout: 15_000 })
    const checkBtn = page.getByRole('button', { name: /Kiểm tra cập nhật|Check for updates/i })
    await checkBtn.waitFor({ timeout: 10_000 })
    // Dev build → updater disabled; nút kiểm tra khoá vì reason=dev
    await page.getByText(/Cập nhật tự động chưa bật \(dev\)|Auto-update disabled \(dev\)/i).first().waitFor({
      timeout: 10_000,
    })
    await pwExpect(checkBtn).toBeDisabled()
  }, 60_000)

  it('đổi ngôn ngữ sang English', async () => {
    await page.getByRole('link', { name: /Cài đặt|Settings/i }).click()
    await page.getByRole('combobox', { name: /Ngôn ngữ|Language/i }).click()
    const option = page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
      .filter({ hasText: /^English$/ })
    await option.waitFor({ state: 'visible', timeout: 15_000 })
    await option.click()
    await pwExpect(page.getByRole('link', { name: /^Settings$/i })).toBeVisible({ timeout: 10_000 })
  }, 60_000)

  it('mở modal phím tắt từ Settings', async () => {
    await page.getByRole('link', { name: /Settings|Cài đặt/i }).click()
    await page.getByRole('button', { name: /Keyboard shortcuts|Phím tắt/i }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText(/Ctrl\/Cmd \+ ,/i).waitFor({ timeout: 10_000 })
    // Footer «Đóng/Close» — tránh trùng với nút X aria-label="Close" của antd.
    await dialog.locator('.ant-modal-footer').getByRole('button').click()
  }, 60_000)
})
