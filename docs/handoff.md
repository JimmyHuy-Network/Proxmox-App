# Bàn giao — hết giai đoạn 6

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải** — tức là
phần kiến thức không đọc ra được từ mã nguồn.

Kế hoạch tổng thể đầy đủ nằm ở [plan.md](plan.md). Hướng dẫn chạy nằm ở [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–6 hoàn tất.** Console (GĐ 5) đã merge vào `main`; Storage (GĐ 6) trên nhánh
này: content browser, upload/download stream qua main, vzdump + lịch backup, restore wizard,
CRUD storage + scan, PBS fixture cơ bản.

| Hạng mục | Trạng thái |
|---|---|
| Bộ khung Electron + bảo mật + i18n tiếng Việt | Xong |
| Schema + client 675 endpoint + mock schema-router | Xong |
| Vault / TOFU / TFA / connection pool / IPC | Xong |
| Resource poller + TaskDock + RrdChart + cây tài nguyên | Xong |
| Guest lifecycle GĐ 4 (Hardware, Options, Cloud-Init, wizard, snapshot, clone…) | Xong |
| **Relay console + upstream session + noVNC/xterm + shell/SPICE** | Xong, GĐ 5 |
| **Mock** termproxy/vncproxy/spiceproxy + WS + FakeShell + FakeRfb | Xong, GĐ 5 |
| **Storage drawer** (overview/content/backup jobs) + chọn storage trên cây | Xong, GĐ 6 |
| **Upload multipart stream qua main** + tiến trình/huỷ (`pve:transfer`) | Xong, GĐ 6 |
| **download-url / vzdump / prune / restore** | Xong, GĐ 6 |
| **Backup jobs CRUD** (`/cluster/backup`) + not-backed-up | Xong, GĐ 6 |
| **Storage CRUD + scan NFS/PBS/…** | Xong, GĐ 6 |
| **Mock** multipart upload, Fake volumes, nfs-backup + pbs-lab fixture | Xong, GĐ 6 |

Cả bốn nhánh xác thực (ticket, token, TFA, trust-on-first-use chứng chỉ) đã được kiểm
đầu-cuối với mock HTTPS tự ký trong `connection-pool.test.ts` từ giai đoạn 2.

**Giai đoạn 6 đóng.** Việc tiếp theo là **giai đoạn 7 — hạ tầng node & cluster** (xem mục 6).

### Kiểm chứng lại toàn bộ

```bash
npm test && npm run typecheck && npm run lint
```

```bash
# Mock + app với vault plaintext (headless không có libsecret)
npm run dev:mock
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run dev
```

---

## 2. Những cái bẫy đã vấp — đừng vấp lại

(Giữ nguyên các bẫy GĐ 0–4 trong lịch sử git / các mục dưới đây là bổ sung GĐ 5.)

### Handshake `user:ticket\\n` → `OK` thuộc main, không phải renderer

Sau khi mở WSS tới `/vncwebsocket`, Proxmox yêu cầu client gửi `user:ticket\\n` rồi chờ
`OK` trước khi luồng term/RFB bắt đầu. Main làm bước này trong `upstream-session.ts` rồi
mới pipe byte sang relay — renderer **không bao giờ** thấy ticket. Nếu đưa WebSocket cho
noVNC trước khi handshake xong, noVNC sẽ cố parse `OK` như phiên bản RFB và hỏng.

### noVNC nhận WebSocket đang sống, không nhận URL

`new RFB(target, ws)` — đây là lý do kiến trúc relay chạy được. Đừng đổi thành
`new RFB(target, 'wss://…')` vì renderer không có Cookie/Referer/cert pin.

### Import `@novnc/novnc` từ package root

`exports: './core/rfb.js'` (chuỗi đơn). Import `@novnc/novnc/lib/rfb.js` sẽ 404.
Ghim Vite 7 — Vite 8/Rolldown từ chối top-level await trong noVNC.

### Vé console mock gắn user + target (PSA-2026-00014-1 / CVE-2026-51082)

Advisory mô tả race vncproxy↔vncwebsocket cho phép cướp phiên VNC của user khác.
Client của ta đi đúng luồng web UI nên không thêm bề mặt tấn công. Mock **cố ý** gắn
vé với `user + node + vmid + vmtype` và tiêu thụ một lần — không tái tạo lỗ hổng.

### Cửa sổ tách phải mở từ main

`setWindowOpenHandler` chặn mọi popup từ renderer. Dùng `createConsoleWindow` trong
main, truyền `relayUrl` qua hash `#/console/session?...`. Token một lần — cửa sổ tách
nối thẳng, **không** gọi `console.open` lại.

### `term-protocol` chuyển sang `@pve/api`

Mock và desktop cùng dùng. `apps/desktop/src/shared/term-protocol.ts` chỉ còn re-export
qua alias `@shared` cho electron-vite/vitest.

### Fake shell demo (`DEMO_CONNECTION_ID`) vẫn còn

Shell nội bộ trong main vẫn phục vụ trang Console khi chưa có kết nối. Fake shell
**thật** cho mock nằm ở `apps/mock-server/src/console/fake-shell.ts`. Có thể gỡ demo
khi không còn cần offline spike.

---

## 3. Quyết định kiến trúc đã chốt (bổ sung GĐ 5)

**API Token mở được console trên PVE 9.2** — đã xác nhận trên server thật (handoff GĐ 2–3).
Main gửi header `Authorization` trên WebSocket; ticket thì gửi `Cookie`.
`AuthProvider` có thêm `authorizationHeader()` và `consoleUsername()`.

**SPICE không nhúng spice-html5** — ghi `.vv` tạm + `shell.openPath` cho virt-viewer.

**Push event tới mọi BrowserWindow** — cửa sổ console tách cũng nhận `console-closed`.

---

## 4. Chỗ đã làm khác kế hoạch (bổ sung)

**Fake shell vẫn giữ bản copy trong desktop** cho `DEMO_CONNECTION_ID`, ngoài bản mock-server.
Không worth tạo package riêng chỉ để share ~300 dòng.

**VNC clipboard + quality** đã bổ sung: slider chất lượng (0–9), nút dán clipboard host→guest
(`clipboardPasteFrom`), và lắng sự kiện `clipboard` guest→host khi server hỗ trợ.

---

## 5. Schema / đối chiếu (nhắc lại)

- Node shell VNC dùng `/nodes/{node}/vncshell`, **không** có `/nodes/{node}/vncproxy`.
- Cả term và VNC đều nối `/vncwebsocket` sau khi lấy port+ticket từ proxy.
- `/access/vncticket` tồn tại trong schema 9.2; chưa dùng trong app (relay tự handshake).

---

## 6. Việc tiếp theo — giai đoạn 7 (node & cluster)

### Giai đoạn 6 đã đóng

1. Mock: `handlers/storage.ts` — content CRUD, multipart upload, download-url, vzdump,
   prune, backup jobs, scan helpers, PBS file-restore list; fixture `nfs-backup` + `pbs-lab`.
2. Desktop main: `pve:transfer` + `multipart-upload.ts` (stream đĩa → HTTPS, progress/cancel).
3. Renderer: storage selectable trên cây → `StorageDrawer` (overview/content/backup jobs),
   restore wizard, thêm storage + scan NFS/PBS.
4. Tiêu chí plan §8: test upload **10 MB** + huỷ giữa chừng (`multipart-upload.test.ts`).

### Gap GĐ 0–6 đã hoàn tất (nhánh gaps)

- Fixture `huge` (8 node / ~400 guest) + `scripts/generate-huge.mjs`.
- Cluster log UI (`GET /cluster/log`) + tìm kiếm toàn cục trên header.
- VNC clipboard paste + quality slider.
- Form thêm storage đủ loại (cifs/iscsi/lvm/lvmthin/zfspool/rbd/cephfs/pbs…).
- PBS file-restore list/download UI; nút tải volume local qua `pve:transfer`.
- `build:win`: đã verify trên Linux — `electron-builder --win` đóng gói được
  `release/win-unpacked/Proxmox VE Manager.exe` (~216 MB). Bước NSIS cần `wine`
  (chưa có trên VM này) nên installer `.exe` đầy đủ chỉ build được trên Windows
  hoặc máy có wine. Ký số vẫn để sau.

### Giai đoạn 7 — hạ tầng node & cluster (plan §6)

Network (bridge/bond/VLAN/OVS + pending/apply/revert), DNS/hosts/time, disks + SMART,
LVM/ZFS/directory, Ceph đầy đủ, certificates/ACME, apt + updates, syslog/journal,
cluster join/create. Dùng fixture `broken-cluster` khi có (Ceph degraded, node chết).

### Điểm nối / bẫy vẫn còn hiệu lực

- `TaskButton` / `PveGrid` / `PveForm` — dùng lại.
- Upload lớn **chỉ** qua main (`pve:transfer`), không qua `pve:request` urlencoded.
- Multipart mock: hook `preValidation` chuyển parts → body phẳng trước schema validate.
- Console: handshake `user:ticket` trong main; noVNC nhận WebSocket đã sống.
- **Bẫy QEMU `memory`:** type chuỗi trên PUT config — phải `String(memory)`.
- Headless: `PVE_E2E_MOCK_URL` + `E2ePlainEncryptor` (không có libsecret).

---

## 7–8. Đối chiếu PVE thật & câu hỏi để ngỏ

Giữ nguyên các kết luận đối chiếu GĐ 2–3 trong lịch sử (token console OK, cookie encode,
task UPID thật, rrddata thừa trường vô hại).

Câu hỏi còn lại:

1. **Ký số Windows** — EV/OV trước phát hành.
2. Icon riêng (đang dùng mặc định Electron).
