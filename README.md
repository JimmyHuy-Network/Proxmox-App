# Proxmox VE Manager

Ứng dụng desktop (Electron) quản lý Proxmox VE — mục tiêu đầy đủ tính năng như web UI gốc.

> **Trạng thái: hết giai đoạn 9** + **Modern Hi-Tech UI** đã merge. Giai đoạn 0–8 = Access /
> Firewall / SDN / HA / replication / notify / metrics + cap UI. GĐ 9 = auto-update wiring,
> logging/crash hooks, phím tắt, Settings/i18n, tài liệu ký số & nested PVE. UI refresh
> (Obsidian + cyan/orange glow, glass, LED, dashboard gauges, Ctrl+K search, guest 3-pane)
> bám ảnh mẫu trong [`docs/ui-mockups/`](docs/ui-mockups/) — chi tiết đã/chưa làm ở
> [`docs/handoff.md`](docs/handoff.md) §5.

Chi tiết bàn giao: [`docs/handoff.md`](docs/handoff.md) · kế hoạch: [`docs/plan.md`](docs/plan.md) ·
UI mockups: [`docs/ui-mockups/`](docs/ui-mockups/) · kế hoạch UI:
[`.cursor/plans/modern_tech_ui_plan.md`](.cursor/plans/modern_tech_ui_plan.md) · ký số:
[`docs/decision-windows-signing.md`](docs/decision-windows-signing.md) · PVE lab:
[`docs/nested-pve-hyperv.md`](docs/nested-pve-hyperv.md).

---

## Yêu cầu

| | |
|---|---|
| **Node.js** | **≥ 22.19**. Mock chạy `node src/index.ts` nhờ type-stripping native; `undici` cần ≥ 22.19. |
| **npm** | Đi kèm Node (repo dùng npm workspaces). |
| **OS** | Dev trên Linux/macOS/Windows. Installer Windows qua `build:win`. |
| **Display** | Electron cần display. Trên VM headless dùng `DISPLAY=:1` (hoặc Xvfb). |

Kiểm tra phiên bản:

```bash
node --version   # ví dụ v22.22.2
```

---

## Cài đặt

```bash
npm install
```

`postinstall` tự sinh client typed từ `pve-9.2.schema.json` (không cần mạng).

Electron 43 **không** tự tải binary qua `postinstall` — sau lần cài đầu chạy thêm:

```bash
node node_modules/electron/install.js
```

---

## Chạy mock Proxmox

Mock là môi trường phát triển chính khi chưa có cluster thật: HTTPS tự ký, **675 endpoint**
theo schema PVE 9.2, fixture trong bộ nhớ.

```bash
npm run dev:mock
```

Mặc định: `https://127.0.0.1:8006`, fixture `cluster-3node` (pve1/pve2/pve3 + VM/CT).

### Tuỳ chọn CLI

```bash
# Từ thư mục apps/mock-server
npm run dev -- --port 8006 --fixture cluster-3node
npm run dev -- --fixture huge --quiet
```

| Flag | Mặc định | Ý nghĩa |
|---|---|---|
| `--port` | `8006` | Cổng HTTPS |
| `--fixture` | `cluster-3node` | Kịch bản seed |
| `--quiet` | off | Tắt log Fastify |

| Fixture | Nội dung |
|---|---|
| `cluster-3node` | 3 node, vài guest, storage local/NFS/PBS — dùng hàng ngày |
| `huge` | 8 node / ~400 guest — smoke cây tài nguyên / tìm kiếm |
| `broken-cluster` | pve3 offline, Ceph `HEALTH_WARN` — kiểm UI degraded |

Đổi fixture khi server đang chạy:

```bash
curl -k -X POST https://127.0.0.1:8006/__mock/scenario/huge
curl -k https://127.0.0.1:8006/__mock/fixtures
```

### Đăng nhập mock

| | |
|---|---|
| Ticket | User bất kỳ, mật khẩu bất kỳ **trừ** chuỗi `sai` |
| TFA | User `tfa@pve`, OTP giả lập `123456` |
| API Token | `root@pam!automation=00000000-1111-2222-3333-444444444444` |

### API điều khiển (chỉ dev)

```bash
# Node offline
curl -k -X POST https://127.0.0.1:8006/__mock/node/pve2/offline \
  -H 'Content-Type: application/json' -d '{"offline":true}'

# Reset state / tiêm latency / ép lỗi
curl -k -X POST https://127.0.0.1:8006/__mock/reset
curl -k -X POST https://127.0.0.1:8006/__mock/latency \
  -H 'Content-Type: application/json' -d '{"ms":200,"jitter":50}'
```

Còn `/__mock/fail`, `/__mock/state` — dựng UI cho trạng thái hỏng khi không có cụm thật.

Sinh lại fixture `huge` (khi chỉnh cấu trúc):

```bash
node apps/mock-server/scripts/generate-huge.mjs
```

---

## Chạy app (dev)

Terminal 1 — mock:

```bash
npm run dev:mock
```

Terminal 2 — desktop:

```bash
npm run dev
```

Trong app: **Kết nối** → **Thêm kết nối** → host `127.0.0.1`, port `8006`, user `root@pam`,
mật khẩu bất kỳ (trừ `sai`). Tin tưởng chứng chỉ tự ký (TOFU) → cây Datacenter/node/guest hiện.

Phím tắt hữu ích khi smoke: **Ctrl+K** (Global Search) · **Ctrl+,** (Settings) ·
**Ctrl+3** Access · **Ctrl+4** Firewall · **Ctrl+5** Datacenter.

### Headless / không có libsecret

Trên VM không có OS keyring, UI “Thêm kết nối” không mã hoá được credential. Dùng hook E2E
(seed vault plaintext + tự kết nối mock):

```bash
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run dev
```

Tuỳ chọn: `PVE_E2E_USER` (mặc định `root@pam`), `PVE_E2E_PASSWORD` (mặc định `x`).

Hook này chỉ hoạt động trong bản dev với URL HTTPS loopback. Credential thử nghiệm
được lưu riêng trong `userData/e2e/vault.json`; bản đóng gói bỏ qua hook.
Upload/download luôn yêu cầu chọn file bằng hộp thoại trong main process.

### Smoke khởi động (CI)

```bash
cd apps/desktop && PVE_SMOKE_TEST=1 npx electron .
```

Nạp renderer, thu cảnh báo/lỗi console (kể cả CSP), thoát 0 nếu sạch.

---

## Build

### Build app (main + preload + renderer)

```bash
npm run build
```

Ra thư mục `apps/desktop/out/` (chưa đóng gói installer).

Chỉ typecheck:

```bash
npm run typecheck
```

### Build Windows installer (`build:win`)

```bash
npm run build:win
```

Chạy `electron-vite build` rồi `electron-builder --win` (target NSIS x64).

| Đầu ra | Đường dẫn |
|---|---|
| Thư mục giải nén | `apps/desktop/release/win-unpacked/` |
| Binary | `apps/desktop/release/win-unpacked/Proxmox VE Manager.exe` |
| Installer NSIS | `apps/desktop/release/Proxmox VE Manager-0.1.0-x64.exe` |

**Lưu ý trên Linux:** bước đóng gói `win-unpacked` chạy được; **NSIS cần `wine`**.
Không có wine thì có `.exe` trong `win-unpacked` nhưng installer NSIS có thể thất bại.
Trên Windows native thì `build:win` ra đủ installer.

Chỉ đóng gói thư mục (không NSIS):

```bash
npm run build:unpack --workspace=@pve/desktop
```

Installer **chưa ký số** — SmartScreen sẽ cảnh báo khi cài.

### Phát hành + auto-update

`electron-builder` publish lên **GitHub Releases** (`JimmyHuy-Network/Proxmox-App`).
Workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) chạy khi
push tag `v*` (hoặc `workflow_dispatch`):

CI và Release dùng runner Linux x64 có nhãn `self-hosted`, `Linux`, `X64`.
Release vẫn tạo installer **Windows x64 (NSIS)** bằng `electron-builder --win`.
Runner cần Bash, Git và Wine (`wine`) trên PATH; release cần thêm GitHub CLI (`gh`).
Workflow kiểm tra Wine trước khi build và dùng `USE_SYSTEM_WINE=true`.
Trên Ubuntu có thể cài bằng `sudo apt-get update && sudo apt-get install -y wine`,
sau đó kiểm tra `wine cmd /c exit 0` dưới tài khoản chạy runner.
CI chỉ chạy PR có nhánh nguồn trong repo này;
PR từ fork không chạy mã trên máy self-hosted. Build trên Linux chưa thay thế
việc kiểm thử installer và auto-update trên Windows thật.

CI chạy trên push/PR nội bộ hoặc `workflow_dispatch`, kiểm tra mã rồi đóng gói
installer Windows bằng Wine và lưu artifact `windows-x64-<commit>`, không publish release.

```bash
# ví dụ phát hành 0.2.0
git tag v0.2.0
git push origin v0.2.0
```

Workflow pre-create **draft** release, `electron-builder` upload `.exe` /
`.blockmap` / `latest.yml`, rồi publish. (eb26 upload song song dễ tạo 2 release
cùng tag nếu chưa có draft — đã gặp ở lần `v0.2.0` đầu.)

Republish tag có sẵn (sau khi sửa workflow): Actions → **Release** →
Run workflow → nhập tag `v0.2.0`.

Hoặc local (cần `GH_TOKEN` có quyền release):

```bash
npm run release:win
```

Bản cài packaged tự `checkForUpdates` (GitHub `latest.yml`). Dev build hiện
“Cập nhật tự động chưa bật (dev)”. Test feed generic không cần đóng gói:

```bash
PVE_UPDATE_URL=https://example.com/updates npm run dev
```

**Lưu ý:** repo **public** — electron-updater trên máy người dùng đọc GitHub
Releases không cần token. Ký số: xem
[`docs/decision-windows-signing.md`](docs/decision-windows-signing.md).

---

## Kiểm thử & chất lượng

```bash
npm test              # vitest toàn monorepo
npm run typecheck
npm run lint
```

---

## Bảng lệnh gốc

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | App Electron + Vite HMR (renderer `:5173`) |
| `npm run dev:mock` | Mock PVE HTTPS `:8006` |
| `npm run build` | Build production vào `apps/desktop/out/` |
| `npm run build:win` | Build + electron-builder Windows (NSIS) |
| `npm run release:win` | Build Windows + publish GitHub Releases |
| `npm test` | Toàn bộ test |
| `npm run typecheck` | `tsc` main/preload + renderer |
| `npm run lint` | ESLint |
| `npm run schema:fetch` | Tải lại `apidoc.js` từ Proxmox |
| `npm run schema:generate` | Sinh lại client typed từ schema |

---

## Cấu trúc

```
packages/pve-schema/     Schema PVE 9.2 đã chuẩn hoá
packages/pve-api/        Client typed + auth/transport
packages/pve-ipc/        Hợp đồng IPC (chỉ type)
apps/mock-server/        Mock HTTPS + fixture + /__mock/*
apps/desktop/src/main/   Main: mạng, vault, relay console, transfer
apps/desktop/src/preload contextBridge (mỏng)
apps/desktop/src/renderer React UI (sandbox, không Node)
```

---

## Quyết định kỹ thuật (tóm tắt)

**Mọi mạng qua main.** Renderer không thấy credential/ticket/host — chỉ `connectionId`.
CSP không cho `connect-src` tới host Proxmox.

**Console qua relay trong main.** `/termproxy` kiểm `Referer`; Chromium không set được trên
WebSocket; cookie jar Electron đụng nhau giữa cluster. Relay giải cả ba; noVNC nhận
`WebSocket` đã sống.

**Ghim Vite 7** (`electron-vite@5` + tương thích `@novnc/novnc`).

**Không dùng `@xterm/addon-attach`.** Termproxy bất đối xứng (`0:<bytes>:<data>` chiều gửi).
Xem `term-protocol` — số byte là UTF-8 bytes, không phải `String.length`.
