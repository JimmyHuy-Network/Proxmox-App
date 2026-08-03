# Bàn giao — hết GĐ 9 + Modern Hi-Tech UI + audit 08/2026

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải**.

Kế hoạch: [plan.md](plan.md) · UI mockup plan: [../.cursor/plans/modern_tech_ui_plan.md](../.cursor/plans/modern_tech_ui_plan.md) ·
**Plan sửa lỗi sau audit: [../.cursor/plans/stability_polish_plan.md](../.cursor/plans/stability_polish_plan.md)** ·
Ảnh mẫu: [ui-mockups/](ui-mockups/) · Chạy thử: [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–9 hoàn tất** trên `main` (GĐ 9 = hardening & phát hành MVP).

**Modern Hi-Tech UI** đã merge `main` qua PR #12 (`1f487fa`) — visual refresh
bám [ui-mockups/](ui-mockups/) theo [modern_tech_ui_plan.md](../.cursor/plans/modern_tech_ui_plan.md).
Audit source↔plan↔mockup trong §5; phần polish còn lại ở §5.4.

| Hạng mục | Trạng thái |
|---|---|
| GĐ 0–8 | Xong (`main`) |
| GĐ 9 (update / crash log / shortcuts / i18n / a11y tối thiểu / perf signature) | Xong (`main`) |
| **Ký số Windows** | Chưa mua cert — [decision-windows-signing.md](decision-windows-signing.md) |
| **Modern Hi-Tech UI** | Đã merge (`main`); theme+search+dashboard **DONE**; shell/guest/firewall-access **PARTIAL** — §5 |

### Kiểm chứng

```bash
npm test && npm run typecheck && npm run lint   # 265 passed / 9 skipped (đo lại 08/2026)
npm run build --workspace=@pve/desktop
ELECTRON_E2E=1 xvfb-run -a npx vitest run apps/desktop/electron-e2e
# LƯU Ý: hiện 8/9 — guest-lifecycle fail thật sau merge UI (selector snapshot), xem §7.2
```

```bash
npm run dev:mock
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run -w @pve/desktop dev
# Settings: Ctrl+, · Access: Ctrl+3 · Firewall: Ctrl+4 · Datacenter: Ctrl+5
# Search: Ctrl+K · user hạn chế: PVE_E2E_USER=vanhanh@pve
```

**Caveat cloud VM:** Electron `safeStorage` không có → form “Thêm kết nối” không mã hoá được credential.
Dùng `PVE_E2E_MOCK_URL` (hook E2E) để seed vault plain-text + auto-connect. Chi tiết [AGENTS.md](../AGENTS.md).

**Caveat cloud VM (mới, 08/2026):** `/dev/shm` chỉ 64 MB → renderer **crash chắc chắn**
(đen màn hình, `exitCode: 5`) khi mở GuestDrawer (nhiều canvas). Chạy dev với
`npx electron-vite dev -- --disable-dev-shm-usage` cho tới khi làm todo `stability-devshm`
trong [stability_polish_plan.md](../.cursor/plans/stability_polish_plan.md). Chi tiết §7.1.

---

## 2. Quyết định GĐ 9 (còn hiệu lực)

**Logging:** `electron-log` file trong `userData/logs` — không Sentry.

**Updater:** `electron-builder.yml` đã bật `publish` → GitHub Releases
(`phamhuyti/Proxmox-App`). Packaged app check sau 5s + nút Settings. Dev → UI
`disabled (dev)`. CI: tag `v*` → [`.github/workflows/release.yml`](../.github/workflows/release.yml)
build NSIS + upload release (`latest.yml`). Repo **public** → client tải
artifact không cần token; tuỳ chọn test feed generic bằng `PVE_UPDATE_URL`.

**Ký số:** unsigned + tài liệu; CI dùng `CSC_LINK` / `CSC_KEY_PASSWORD` khi có cert.

**Shortcuts:** Menu accelerators → IPC `app:shortcut` → `useAppShortcuts` (không globalShortcut).

**Perf:** `resourcesSignature` trong store — poll 3s không đổi thì không thay reference mảng.

---

## 3. Việc tiếp theo (sau GĐ 9 / ngoài UI)

0. **Trước hết:** làm [stability_polish_plan.md](../.cursor/plans/stability_polish_plan.md)
   (bug từ audit §7 — crash /dev/shm, hồi phục renderer, health chips đứng im, E2E 8/9…).
1. Mua EV/OV; gán `CSC_*` vào secrets CI (publish GitHub + workflow Release đã có;
   repo đã public). (`icon.png` đã = mockup; tuỳ chọn `.ico`)
2. Virtualize Tree/table khi `huge` (400 guest) nếu profiler còn nóng — audit 08/2026 đo
   GUI thực tế với 400 guest vẫn mượt (tree/search/drawer), chưa cần ưu tiên.
3. Đối chiếu định kỳ với PVE thật — [nested-pve-hyperv.md](nested-pve-hyperv.md).
4. Deep-link hash `?tab=` cho Access/Firewall nếu cần chia sẻ URL nội bộ.
5. Làm các mục polish UI còn lại ở §5.4 (đã gom vào plan mới, nhóm C).

### Điểm nối còn hiệu lực

- Settings `/settings` · `window.pve.app.*` · `useUpdate` · `useAppShortcuts`
- `TaskButton` / `CapButton` / `usePermissions`
- Mock handlers GĐ 6–8 + E2E `PVE_E2E_MOCK_URL`
- UI: `theme/tokens.ts` · `styles.css` · `TechUi.tsx` · shell/search/dashboard/guest skins

---

## 4. Câu hỏi để ngỏ

1. Chứng chỉ ký số EV vs OV (xem decision doc).
2. (Tuỳ chọn) `icon.ico` cho NSIS nếu builder không derive đủ từ png.
3. Kênh update: GitHub Releases hay generic URL nội bộ.
4. Ưu tiên kéo pixel-mockup (guest embed, search IP, quorum API) ở §5.4, hay chuyển sang ký số/publish?

---

## 5. Modern Hi-Tech UI — audit plan ↔ source ↔ mockup

**Nguồn plan:** [.cursor/plans/modern_tech_ui_plan.md](../.cursor/plans/modern_tech_ui_plan.md)  
**Nguồn visual:** [ui-mockups/](ui-mockups/) (`app_icon`, `ui_dashboard_overview`, `ui_resource_tree_search`, `ui_guest_vm_console`, `ui_datacenter_sdn_firewall`, `ui_access_security_vault`)  
**Đã merge:** PR #12 → `main` (`1f487fa`). Nhánh làm việc lịch sử: `cursor/modern-hi-tech-ui-24d9`.

**Commits UI (trước squash/merge):** `415dd32` (shell) → `7b9def9` (sider/search fix) → `cae717e` (gap-fill) → docs audit.

**Verdict tổng:** không phase nào NOT DONE hoàn toàn. Theme + Global Search + Dashboard đạt tiêu chí plan “phải đạt”; Shell / Guest / Firewall–Access–SDN là **skin + layout gần mẫu**, còn lệch IA/pixel so với ảnh.

### 5.1 Checklist theo todo plan

#### `theme-foundation` — **DONE**

| Plan yêu cầu | Source |
|---|---|
| Palette Obsidian / Ember `#ff6b00` / Cyan `#00f2fe` / Emerald `#00f5a0` / Error `#ff4d6d` | `theme/tokens.ts` → `PVE_COLORS` + `pveAntdToken` |
| `darkAlgorithm` + `compactAlgorithm` | `Providers.tsx` |
| `.tech-glass-card`, `.led-*`, `.neon-border`, cyber scrollbar, micro-grid, `prefers-reduced-motion` | `styles.css` |
| `LedDot` / `TechDonut` | `components/TechUi.tsx` |
| `app_icon.png` → header + build icon | Binary **identical** mockup → `renderer/assets/app-icon.png` **và** `resources/icon.png` |

Thiếu nhỏ ngoài plan: `electron-builder` chưa khai báo tường minh `.ico` (PNG đã có trong `buildResources`).

#### `shell-header-sider` — **PARTIAL** (core DONE)

**Đã làm (khớp plan):**
- Brand: icon + tên app + tagline “SERVER MANAGER” — `AppLayout.tsx`
- Ô search header + hint `Ctrl+K` mở `GlobalSearch`
- Health chips Cluster / Quorum / Ceph (Ceph ẩn khi API fail) — `ClusterHealthChips`
- Bell → `/cluster-log` (không invent inbox)
- **Create VM / Create CT** trên header + wizard
- Connection switcher `neon-border` + LED phase
- Menu selected cyan (tokens Menu)
- `ResourceTree`: LED + icon VM/CT/Storage/Node; hover/selected neon; **không** nhồi CPU/RAM mọi hàng
- Warning triangle `isDegraded` (node offline / lock / cpu>90% / disk>85%)
- `TaskDock`: mono + tag `OK` / `RUNNING` / `FAIL`

**Chưa đạt plan/mockup:**
- Quorum chỉ heuristic `online > 0` — **không** đọc quorum từ cluster status API
- Header **không** hiện user `root@pam` cạnh connection (mockup + plan có)
- Bell **không** badge số thông báo như mockup dashboard
- Sider = Menu route app + tree (đúng “chấp nhận lệch” plan) — **không** copy “Server View / Datacenter Infrastructure” IA của ảnh

#### `global-search-modal` — **DONE** (1 gap có chủ đích)

**Đã làm = `ui_resource_tree_search`:**
- Modal glass + `neon-border-active` + blur (`tech-search-modal`)
- Title + shortcut; nhóm QEMU / LXC / Storage / Nodes
- LED + type tag; storage `Progress` `disk/maxdisk`
- Quick Start / Stop (`TaskButton`) + Console (`select` guest)
- Ctrl+K (listener + menu accelerator)

**Chưa / lệch mockup:**
- **Không render IP** guest/node (plan: chỉ hiện nếu đã có cache; hiện không có field → không fan-out API — đúng plan, lệch ảnh)
- Không count “N results” từng nhóm
- Console chỉ pick guest, không ép mở tab Console

#### `dashboard-command` — **DONE** (polish PARTIAL vs ảnh)

**Đã làm = `ui_dashboard_overview`:**
- Summary cards: Nodes / VMs / CTs / Storage / Uptime
- Gauges: `TechDonut` + sparkline RRD (CPU / RAM / Disk)
- Lower grid: multi-series chart + Top by CPU + Quick Metrics
- Alerts strip từ `/cluster/log` (pri≤5) + link cluster-log
- Timeframe `hour|day|week` Segmented
- Bảng guests giữ dưới

**Chưa đạt pixel mockup:**
- Sparkline/trend = **1 node đại diện**, chưa aggregate multi-node
- Chart dưới chủ yếu CPU+RAM (Disk series mockup yếu / thiếu)
- Quick Metrics: cores/RAM/storage/tasks — **không** replication/backup counts (plan cho phép ẩn)
- “Running x/y” nằm hint phụ, mockup nhấn số Running trên card

#### `guest-workspace` — **PARTIAL** vs `ui_guest_vm_console`

**Đã làm:**
- Wide drawer ~`0.92 * width` (cap 1280) ≈ 90%
- Action bar: Start / Shutdown / Snapshot / Console / Stop / Reboot + LED + uptime
- Hardware summary + **4 mini RRD** (cpu, mem, net, disk I/O)
- Layout 3 cột CSS `.guest-workspace-grid` (hardware+charts \| console \| form)
- Console chrome: CAD / Clipboard / Fullscreen (`VncPane.tsx`)
- **Không** Matrix Live Feed / FPS / latency (đúng non-goal plan)

**Chưa đạt plan/ảnh:**
- Vẫn **Drawer**, chưa embed content cố định như mockup window (plan chấp nhận wide split; ảnh là full workspace)
- Panel phải: chỉ `CpuMemoryForm` — **thiếu** Network firewall toggle (plan nêu rõ)
- Nút action Ant Design thường, chưa “large glass glow” như mockup
- 3-pane nằm trong tab Overview; các tab cũ vẫn giữ

#### `firewall-access-skin` — **PARTIAL** vs SDN+Access mockups

**Firewall — DONE skin:**
- Glass wrapper, summary chips Rules / Enabled / ACCEPT / DROP
- Pill `ACCEPT`/`DROP` neon, enable Switch (read-only khi không quyền)
- **Không** IPS / packets 24h / GeoIP (đúng non-goal)

**Firewall — lệch ảnh `ui_datacenter_sdn_firewall`:**
- Không “ops center” chung SDN+Firewall một trang
- Không zone matrix kéo-thả / packets columns / threat panel

**SDN — DONE tối thiểu plan:**
- Cards đếm zones / vnets
- Topology SVG hierarchical zones→vnets (`sdn-topo-wrap`, glow)

**SDN — lệch ảnh:**
- Không Subnets card, Internet/Edge, force-directed, minimap, live data-flow, threat legend

**Access — DONE skin vs `ui_access_security_vault`:**
- Summary Users / TFA / Roles / ACL
- Permission matrix rút gọn user×role từ ACL (`vault-matrix`)
- Cert inspector fingerprint mono + copy (best-effort `/nodes/{node}/certificates/info`)
- Token status ACTIVE / EXPIRED
- **Không** live TOTP digits (đúng non-goal)

**Access — lệch ảnh:**
- Không scope pills trên tokens (chỉ cột privsep)
- Matrix binary ✓/— — chưa Full / Limited / capability Admin·Audit·Operator như mockup
- Không trust-chain graphic; TFA tab không hero TOTP (cố ý)

### 5.2 Đối chiếu từng ảnh mẫu (vẽ lại UI)

Mục tiêu plan: **giống ảnh nhất có thể** trên API PVE thật; không bịa widget.

| Ảnh mẫu | Mức khớp ước lượng | Đã vẽ lại trong app | Còn lệch rõ so ảnh |
|---|---|---|---|
| `app_icon.png` | ~100% asset | Header mark + `resources/icon.png` = binary mockup | Builder chưa wire `.ico` tường minh |
| `ui_dashboard_overview.png` | ~75–85% | Palette/glass/LED; summary+donut+sparkline; top CPU; alerts; health chips; Create VM/CT; search trigger | Sider IA khác ảnh; không badge bell / `root@pam`; Quorum heuristic; chart/quick metrics đơn giản hơn marketing mockup |
| `ui_resource_tree_search.png` | ~80% | Modal glass+neon; 4 nhóm; LED; Start/Stop/Console; storage %; Ctrl+K | Không IP; không count/group; header thiếu user; TaskDock ≠ bảng Tasks đầy cột mockup |
| `ui_guest_vm_console.png` | ~55–65% | 3-pane trong wide drawer; action bar; 4 charts; console CAD/clipboard/FS | Drawer vs full workspace; thiếu Matrix feed/FPS (**cố ý**); form phải hẹp (thiếu FW toggle); nút chưa glow lớn |
| `ui_datacenter_sdn_firewall.png` | ~30–45% | ACCEPT/DROP pills; summary rules; SDN cards + SVG topo đơn giản | Packets 24h / threat / live flow / GeoIP (**cố ý không**); SDN∥Firewall tách route; topo chưa force-graph marketing |
| `ui_access_security_vault.png` | ~40–55% | Summary cards; matrix rút gọn; cert fingerprint; token ACTIVE/EXPIRED | Live TOTP (**cố ý không**); thiếu scope pills / trust-chain / capability Full·Limited |

### 5.3 Cố ý không làm (plan + ảnh marketing)

| Widget trên mockup | Lý do |
|---|---|
| Threat IPS / DDoS / GeoIP / malware toggles | Không có trong PVE API |
| Blocked/Allowed packets 24h, top blocked sources, live data-flow ops | Không có hit-counter / flow API chuẩn trên firewall cluster |
| Live TOTP digits + countdown hero | Không expose secret OTP trên UI quản trị |
| Matrix Live Feed dưới console | Không phải widget PVE chuẩn |
| VNC FPS / latency / QEMU footer giả | Relay hiện tại không cung cấp |
| Force-directed SDN + minimap + threat legend đầy đủ | Plan chỉ yêu cầu topology SVG đơn giản |
| Thay Ant Design / light mode / rewrite toàn form fields | Ngoài scope |
| Copy hết label sider mockup không tồn tại trong app | Plan: chấp nhận lệch IA route thật |

### 5.4 Còn thiếu — làm được (polish sau merge)

1. **Header:** hiện `username` (`root@pam`); Quorum từ `/cluster/status` (hoặc tương đương) thay `online>0`; optional badge bell từ log count.
2. **Global Search:** IP lazy khi agent/resource đã có; count theo nhóm; Console → mở guest + tab console.
3. **Dashboard:** series Disk trên chart dưới; nổi “Running x/y”; optional replication/backup counts nếu query sẵn.
4. **Guest:** Network firewall toggle trên panel phải; cân nhắc embed workspace thay drawer; style action bar gần mockup hơn.
5. **Access:** scope pills tokens; cert lấy node online thật; matrix Limited vs Full nếu derive được từ ACL/roles.
6. **SDN (tuỳ chọn E2):** Subnets count; layout force-directed nhẹ nếu data đủ.
7. **Build:** wire icon `.ico`/png rõ trong electron-builder.
8. **i18n:** vài nhãn dashboard/search vẫn EN trong `vi.ts` (Cluster Overview, Recent Alerts, timeframe…).

### 5.5 Index file UI

| File | Vai trò |
|---|---|
| `apps/desktop/src/renderer/theme/tokens.ts` | Palette + Ant token |
| `apps/desktop/src/renderer/app/Providers.tsx` | dark+compact theme |
| `apps/desktop/src/renderer/styles.css` | glass/LED/neon/scrollbar/grid/guest/fw/sdn |
| `apps/desktop/src/renderer/components/TechUi.tsx` | `LedDot`, `TechDonut` |
| `apps/desktop/src/renderer/app/AppLayout.tsx` | Shell header/sider/health/Create/bell |
| `apps/desktop/src/renderer/features/resources/ResourceTree.tsx` | Tree LED/icons/warn |
| `apps/desktop/src/renderer/features/resources/GlobalSearch.tsx` | Ctrl+K glass modal |
| `apps/desktop/src/renderer/routes/Dashboard.tsx` | Cluster overview |
| `apps/desktop/src/renderer/features/resources/GuestDrawer.tsx` | Wide 3-pane guest |
| `apps/desktop/src/renderer/features/console/VncPane.tsx` | Console chrome |
| `apps/desktop/src/renderer/features/tasks/TaskDock.tsx` | OK/RUNNING/FAIL neon |
| `apps/desktop/src/renderer/features/firewall/FirewallPage.tsx` | Glass + ACCEPT/DROP |
| `apps/desktop/src/renderer/features/access/AccessPage.tsx` | Vault cards/matrix/cert |
| `apps/desktop/src/renderer/features/datacenter/DatacenterExtrasPage.tsx` | SDN cards + topo SVG |
| `apps/desktop/src/renderer/assets/app-icon.png` | Header (= mockup) |
| `apps/desktop/resources/icon.png` | Build (= mockup) |
| `apps/desktop/src/renderer/i18n/en.ts` / `vi.ts` | Keys UI mới |
| `docs/ui-mockups/*.png` | Nguồn visual |

### 5.6 Bẫy / ghi chú vận hành UI

- Sider Ant Design: bắt buộc `.ant-layout-sider-children { display:flex; flex-direction:column; height:100% }` + `.resource-tree-host` — không thì tree bị đè / click trúng menu Firewall.
- Tree keys: prefix `res:${id}` tránh trùng cảm nhận với storage `local` trên nhiều node.
- Cloud agent `DISPLAY=:1`: GPU đôi khi die → cửa sổ đen; restart `npm run -w @pve/desktop dev` với `PVE_E2E_MOCK_URL`.
- Node runtime ≥ 22.18 (nvm 22.22.2) — `/exec-daemon/node` 22.14 gãy `dev:mock`.

---

## 6. Gợi ý phiên tiếp theo

1. Làm [stability_polish_plan.md](../.cursor/plans/stability_polish_plan.md) theo thứ tự
   nhóm A (ổn định) → B (bug) → C (polish). Mỗi mục đã ghi rõ file + root cause ở §7.
2. Tiếp các mục §3 (ký số / publish).

---

## 7. Audit 08/2026 — kết quả test & phân tích trên `main` (`29dfaaf`)

Audit toàn diện: unit/typecheck/lint, electron-e2e, test GUI thủ công qua mock trên cả 3
fixture (`cluster-3node`, `broken-cluster`, `huge`), đối chiếu 6 ảnh mockup. Việc sửa nằm ở
[stability_polish_plan.md](../.cursor/plans/stability_polish_plan.md); dưới đây là bằng chứng
và root cause để phiên sau khỏi đào lại.

### 7.1 Lỗi ổn định (nhóm A plan)

| # | Lỗi | Root cause / bằng chứng |
|---|---|---|
| A1 | Renderer crash `exitCode: 5`, cửa sổ đen khi mở GuestDrawer trên cloud VM | `/dev/shm` 64 MB (mặc định container) + 4 uPlot canvas + noVNC canvas mount cùng lúc. Tái hiện 100% ở 3 phiên test; **hết hẳn** khi chạy `--disable-dev-shm-usage`. App chưa tự thêm switch này |
| A2 | Sau crash không hồi phục; log spam mỗi 3s | `logging.ts` chỉ log `render-process-gone`, không `reload()`; `pushEvent` (main/index.ts) vẫn bắn vào webContents đã destroy → `Render frame was disposed…` lặp vô hạn. Chưa có `crashReporter` (GĐ 9 chỉ có electron-log) |

### 7.2 Bug tìm thấy khi test (nhóm B plan)

| # | Bug | Bằng chứng |
|---|---|---|
| B1 | React warning `two children with the same key, '0'` **mỗi nhịp poll 3s** | Quét fiber tree qua CDP: `dup key "0" child=CreateCtWizard` — `AppLayout` đặt `key={vmWizardKey}` / `key={ctWizardKey}`, cả hai khởi tạo `0` |
| B2 | Chip Ceph đứng im: fixture đổi sang `broken-cluster` (`HEALTH_WARN` — mock xác nhận trả đúng) nhưng chip vẫn HEALTHY vô hạn | `cephQuery`/`joinQuery` trong `AppLayout` chỉ có `staleTime`, không `refetchInterval` → fetch đúng 1 lần khi mount |
| B3 | electron-e2e `guest-lifecycle` fail ổn định (8/9) — claim 9/9 cũ là số trước merge UI | `.ant-card input` khớp input **ẩn** của `CpuMemoryForm` tab Overview (3-pane PR #12 giữ mounted khi đổi tab) → fill timeout |
| B4 | 2 phiên VNC song song cho 1 guest | Overview nhúng `GuestConsoleTab`; mở tab Console mount thêm cái thứ hai; antd Tabs không destroy tab đã render |
| B5 | Dashboard hiện `pve-cluster (3 nodes)` hardcode — mock trả tên thật `pve-lab` (`/cluster/status`) | `Dashboard.tsx` chuỗi cứng; cùng chỗ còn nhãn EN hardcode + `vi.ts` nhóm dashboard/search còn nguyên EN (gap §5.4.8 xác nhận còn) |

Deprecation antd v6 trong console (Drawer `width`, Alert `message`) — nhóm C plan.

### 7.3 Đã test OK (không cần động)

- Dashboard đủ panel theo mockup, timeframe 1h/1d/1w đổi chart đúng; không NaN/undefined.
- Ctrl+K: nhóm QEMU/LXC/Storage/Nodes, LED, Start/Stop/Console, storage %; lọc nhanh.
- GuestDrawer 3-pane: action bar, LED+uptime, hardware summary, 4 RRD, console noVNC
  kết nối hiển thị nội dung, form CPU/RAM. Snapshot tạo `test1` OK; start guest → TaskDock
  RUNNING→OK, LED xanh ~3–5s (sau khi có `--disable-dev-shm-usage`).
- `broken-cluster`: chip Cluster chuyển warn, tree pve3 LED đỏ, cards 2/3 online, NodeDrawer
  node offline không crash. (Chip Ceph là B2.)
- `huge` 8 node/400 guest: tree scroll mượt, filter/search <0.5s, drawer <1s — chưa cần virtualize.
- Firewall/Access/SDN/Settings render đủ skin như §5; hiệu ứng glass/LED/neon đúng palette.

### 7.4 Không phải bug

- Lỗi credential trên cloud VM ("safeStorage chưa sẵn sàng") = hạn chế headless đã ghi
  AGENTS.md — dùng hook `PVE_E2E_MOCK_URL`.
- Mock trả đủ status/RRD cho node offline (PVE thật trả lỗi) — chỉ là realism của mock,
  tuỳ chọn siết sau.
