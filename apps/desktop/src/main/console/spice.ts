import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import { formatVirtViewerFile } from './upstream-session.ts'

/**
 * Ghi cấu hình SPICE ra file `.vv` tạm rồi giao cho `virt-viewer` (hoặc app
 * đăng ký sẵn trên hệ thống). Không nhúng spice-html5 trong v1 — đúng kế hoạch.
 */
export async function openSpiceViewer(
  spice: Record<string, unknown>,
  title: string,
): Promise<{ path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'pve-spice-'))
  const safe = title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'console'
  const filePath = join(dir, `${safe}.vv`)
  await writeFile(filePath, formatVirtViewerFile(spice), 'utf8')
  const err = await shell.openPath(filePath)
  if (err) {
    throw new Error(
      `Không mở được virt-viewer (${err}). Cài gói virt-viewer hoặc mở thủ công: ${filePath}`,
    )
  }
  return { path: filePath }
}
