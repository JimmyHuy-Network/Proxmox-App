# Bàn giao — hết giai đoạn 9

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải**.

Kế hoạch: [plan.md](plan.md) · Chạy thử: [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–9 hoàn tất** (GĐ 9 trên nhánh này / PR). Đây là mốc hardening & phát hành
MVP — parity tính năng lớn đã có từ GĐ 0–8; GĐ 9 bổ sung vận hành/release.

| Hạng mục | Trạng thái |
|---|---|
| GĐ 0–8 | Xong (main) |
| **Auto-update** (`electron-updater` + Settings) | Xong, GĐ 9 — cần `publish` khi phát hành |
| **Crash / logging** (`electron-log` + process hooks) | Xong, GĐ 9 |
| **Phím tắt** (application menu accelerators) | Xong, GĐ 9 |
| **Settings / About / ngôn ngữ** | Xong, GĐ 9 |
| **i18n** (vi/en + bỏ chuỗi cứng UI chính) | Xong, GĐ 9 |
| **A11y** (aria trên action buttons, search) | Xong mức tối thiểu, GĐ 9 |
| **Perf** (bỏ qua set resources khi signature giống) | Xong, GĐ 9 |
| **Tài liệu** nested PVE + quyết định ký số | Xong, GĐ 9 |
| **Ký số Windows / icon riêng** | Chưa mua cert — xem [decision-windows-signing.md](decision-windows-signing.md) |

### Kiểm chứng

```bash
npm test && npm run typecheck && npm run lint
```

```bash
# E2E (sau build desktop)
ELECTRON_E2E=1 xvfb-run -a npx vitest run apps/desktop/electron-e2e
```

```bash
npm run dev:mock
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run dev
# Settings: Ctrl+, · Access: Ctrl+3 · user hạn chế: PVE_E2E_USER=vanhanh@pve
```

---

## 2. Quyết định GĐ 9

**Logging:** `electron-log` file trong `userData/logs` — không Sentry (tránh phụ thuộc SaaS).

**Updater:** chỉ `checkForUpdates` khi `app.isPackaged`; chưa cấu hình `publish` thì UI hiện
`disabled`. Khi phát hành: set `publish` GitHub (hoặc generic) trong `electron-builder.yml`.

**Ký số:** giữ unsigned + tài liệu; CI dùng `CSC_LINK` / `CSC_KEY_PASSWORD` khi có cert.

**Shortcuts:** Menu accelerators → IPC `app:shortcut` → `useAppShortcuts` (không globalShortcut).

**Perf:** `resourcesSignature` trong store — poll 3s không đổi thì không thay reference mảng.

---

## 3. Việc tiếp theo (sau GĐ 9)

1. Mua EV/OV + icon; bật `publish` GitHub Releases.
2. Virtualize Tree/table khi `huge` (400 guest) nếu profiler còn nóng.
3. Đối chiếu định kỳ với PVE thật — [nested-pve-hyperv.md](nested-pve-hyperv.md).
4. Deep-link hash `?tab=` cho Access/Firewall nếu cần chia sẻ URL nội bộ.

### Điểm nối còn hiệu lực

- Settings `/settings` · `window.pve.app.*` · `useUpdate` · `useAppShortcuts`
- `TaskButton` / `CapButton` / `usePermissions`
- Mock handlers GĐ 6–8 + E2E `PVE_E2E_MOCK_URL`

---

## 4. Câu hỏi để ngỏ

1. Chứng chỉ ký số EV vs OV (xem decision doc).
2. Icon thương hiệu riêng.
3. Kênh update: GitHub Releases hay generic URL nội bộ.
