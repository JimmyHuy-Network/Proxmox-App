# Bàn giao — hết GĐ 9 + Modern Hi-Tech UI

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải**.

Kế hoạch: [plan.md](plan.md) · UI mockup plan: [../.cursor/plans/modern_tech_ui_plan.md](../.cursor/plans/modern_tech_ui_plan.md) ·
Ảnh mẫu: [ui-mockups/](ui-mockups/) · Chạy thử: [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–9 hoàn tất** trên `main` (GĐ 9 = hardening & phát hành MVP).

**Modern Hi-Tech UI** đang trên nhánh `cursor/modern-hi-tech-ui-24d9` / PR #12 — visual refresh
bám [ui-mockups/](ui-mockups/), **chưa merge main** tại thời điểm bàn giao này.

| Hạng mục | Trạng thái |
|---|---|
| GĐ 0–8 | Xong (`main`) |
| GĐ 9 (update / crash log / shortcuts / i18n / a11y tối thiểu / perf signature) | Xong (`main`) |
| **Ký số Windows** | Chưa mua cert — [decision-windows-signing.md](decision-windows-signing.md) |
| **Modern Hi-Tech UI** (theme + shell + search + dashboard + guest + skins) | Code xong trên PR #12 — xem §5 |

### Kiểm chứng

```bash
npm test && npm run typecheck && npm run lint   # 265 tests pass (PR UI)
npm run build --workspace=@pve/desktop
ELECTRON_E2E=1 xvfb-run -a npx vitest run apps/desktop/electron-e2e   # 9/9 (main / GĐ 9)
```

```bash
npm run dev:mock
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run -w @pve/desktop dev
# Settings: Ctrl+, · Access: Ctrl+3 · Firewall: Ctrl+4 · Datacenter: Ctrl+5
# Search: Ctrl+K · user hạn chế: PVE_E2E_USER=vanhanh@pve
```

**Caveat cloud VM:** Electron `safeStorage` không có → form “Thêm kết nối” không mã hoá được credential.
Dùng `PVE_E2E_MOCK_URL` (hook E2E) để seed vault plain-text + auto-connect. Chi tiết [AGENTS.md](../AGENTS.md).

---

## 2. Quyết định GĐ 9 (còn hiệu lực)

**Logging:** `electron-log` file trong `userData/logs` — không Sentry.

**Updater:** chỉ `checkForUpdates` khi `app.isPackaged`; chưa `publish` → UI `disabled`.

**Ký số:** unsigned + tài liệu; CI dùng `CSC_LINK` / `CSC_KEY_PASSWORD` khi có cert.

**Shortcuts:** Menu accelerators → IPC `app:shortcut` → `useAppShortcuts` (không globalShortcut).

**Perf:** `resourcesSignature` trong store — poll 3s không đổi thì không thay reference mảng.

---

## 3. Việc tiếp theo (sau GĐ 9 / ngoài UI)

1. Mua EV/OV; bật `publish` GitHub Releases. (`icon.png` đã có — tuỳ chọn `.ico`)
2. Virtualize Tree/table khi `huge` (400 guest) nếu profiler còn nóng.
3. Đối chiếu định kỳ với PVE thật — [nested-pve-hyperv.md](nested-pve-hyperv.md).
4. Deep-link hash `?tab=` cho Access/Firewall nếu cần chia sẻ URL nội bộ.
5. **Review + merge PR #12** (Modern Hi-Tech UI), rồi polish còn thiếu ở §5.2.

### Điểm nối còn hiệu lực

- Settings `/settings` · `window.pve.app.*` · `useUpdate` · `useAppShortcuts`
- `TaskButton` / `CapButton` / `usePermissions`
- Mock handlers GĐ 6–8 + E2E `PVE_E2E_MOCK_URL`
- UI tokens: `apps/desktop/src/renderer/theme/tokens.ts` · utilities: `styles.css` · `TechUi.tsx`

---

## 4. Câu hỏi để ngỏ

1. Chứng chỉ ký số EV vs OV (xem decision doc).
2. (Tuỳ chọn) `icon.ico` cho NSIS nếu builder không derive đủ từ png.
3. Kênh update: GitHub Releases hay generic URL nội bộ.
4. Có tiếp tục kéo UI gần pixel-mockup (glow/IA guest) sau khi merge PR #12 không?

---

## 5. Modern Hi-Tech UI — đã làm / chưa làm

Nguồn chân lý visual: [ui-mockups/](ui-mockups/). Kế hoạch triển khai:
[.cursor/plans/modern_tech_ui_plan.md](../.cursor/plans/modern_tech_ui_plan.md).

Nhánh: `cursor/modern-hi-tech-ui-24d9` · PR: https://github.com/phamhuyti/Proxmox-App/pull/12

### 5.1 Đã làm

| Hạng mục | Chi tiết / file chính |
|---|---|
| **Theme foundation** | Ant Design tokens Obsidian / Ember `#ff6b00` / Cyan `#00f2fe` / Emerald; `Providers.tsx` + `theme/tokens.ts` |
| **CSS utilities** | Glass card, LED, neon border, cyber scrollbar, micro-grid, `prefers-reduced-motion` — `styles.css` |
| **App icon** | Header mark từ `docs/ui-mockups/app_icon.png` → `renderer/assets/app-icon.png` |
| **Shell header** | Brand + health chips (Cluster/Quorum/Ceph) + Create VM/CT + bell→cluster-log + connection glow — `AppLayout.tsx` |
| **Resource tree** | LED status, icon loại tài nguyên, neon hover/selected, sider flex clickable — `ResourceTree.tsx` |
| **TaskDock** | Terminal neon labels OK/RUNNING/FAIL — `TaskDock.tsx` |
| **Global Search** | Glass modal grouped QEMU/LXC/Storage/Node + Start/Stop/Console + storage progress; Ctrl+K — `GlobalSearch.tsx` |
| **Dashboard** | Summary cards, SVG donut + sparkline, timeframe 1h/1d/1w, top CPU, quick metrics, alerts strip — `Dashboard.tsx` |
| **Guest workspace** | Wide drawer ~90%; layout 3 cột (hardware+charts \| console live \| config form); action bar; 4 RRD — `GuestDrawer.tsx` |
| **Firewall skin** | Glass cards, ACCEPT/DROP neon pills, enable toggle, summary chips Rules/Enabled/ACCEPT/DROP — `FirewallPage.tsx` |
| **Access skin** | Summary Users/TFA/Roles/ACL, permission matrix rút gọn từ ACL, cert inspector card — `AccessPage.tsx` |
| **SDN skin** | Zone/VNet count cards + topology SVG zones→vnets (glow) — `DatacenterExtrasPage.tsx` |
| **Gap-fill polish** | Neon/glass mạnh hơn, alerts nổi, search modal glow/blur — commit `cae717e` |

Khớp ước lượng so mockup (smoke GUI): Dashboard ~75–85%, Search ~80%, Guest ~60% (có 3-pane nhưng chưa pixel), Firewall/Access/SDN ~35–50% (skin, không phải ops-center đầy đủ).

### 5.2 Chưa làm / cố ý không làm

**Cố ý không làm** (không có API PVE / không an toàn / ngoài scope plan):

| Widget mockup | Lý do |
|---|---|
| Threat IPS / DDoS / GeoIP / malware toggles | Không có trong PVE API |
| Blocked/Allowed packets 24h, top blocked sources | Không có hit-counter chuẩn trên firewall cluster API |
| Live TOTP digits + countdown hero | Không được expose secret OTP trên UI quản trị |
| Matrix Live Feed dưới console | Không phải widget PVE chuẩn |
| VNC FPS / latency footer | Không có trong relay hiện tại |
| Force-directed SDN graph đầy đủ + minimap + threat legend | Chỉ làm topology SVG đơn giản từ zones/vnets |
| Đổi Ant Design / light mode / rewrite từng form field | Giữ stack admin ExtJS-like |

**Còn thiếu / cần polish sau merge (làm được, chưa xong mức mockup):**

1. **Guest IA** — drawer 3-cột đã có; chưa phải trang/workspace cố định như mockup; mở drawer bằng click tree đôi khi flaky trên cloud GPU (sider đã fix flex; nên retest sau merge).
2. **Search** — chưa hiện IP guest (cần agent/`network-get-interfaces`; cố ý không fan-out API khi gõ).
3. **Dashboard** — sparkline/trend phụ thuộc RRD node đại diện; chưa aggregate multi-node chart như mockup marketing.
4. **Access vault** — matrix chỉ “user có ACL role X hay không”, chưa capability Admin/Audit/Operator đầy đủ; cert card best-effort từ `/nodes/{node}/certificates/info`.
5. **Firewall / SDN** — chưa firewall “zone matrix” kéo-thả; topology chưa layout force-directed.
6. **Visual polish** — glow mockup vẫn mạnh hơn app một bậc; i18n mix vi/en trên vài nhãn dashboard (cố ý giữ thuật ngữ PVE).
7. **PR #12 chưa merge** vào `main`.

### 5.3 Bẫy / ghi chú vận hành UI

- Sider Ant Design: bắt buộc `.ant-layout-sider-children { display:flex; flex-direction:column; height:100% }` + `.resource-tree-host` — không thì tree bị đè / click trúng menu Firewall.
- Tree keys: dùng prefix `res:${id}` để tránh trùng cảm nhận với label storage (`local` trên nhiều node).
- Cloud agent DISPLAY=:1: GPU process đôi khi die → cửa sổ đen; restart `npm run -w @pve/desktop dev` với `PVE_E2E_MOCK_URL`.
- Node runtime ≥ 22.18 (nvm 22.22.2) — `/exec-daemon/node` 22.14 sẽ gãy `dev:mock`.

---

## 6. Gợi ý phiên tiếp theo

1. Merge PR #12 sau review visual trên mock.
2. Retest GuestDrawer + Ctrl+K trên máy có GPU ổn định; nếu còn flaky, thêm E2E click tree → drawer.
3. (Tuỳ chọn) IP trong Global Search qua agent lazy-load khi chọn 1 guest.
4. Tiếp các mục §3 (ký số / publish / virtualize).
