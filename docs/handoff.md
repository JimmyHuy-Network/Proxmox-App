# Bàn giao — hết giai đoạn 5

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải** — tức là
phần kiến thức không đọc ra được từ mã nguồn.

Kế hoạch tổng thể đầy đủ nằm ở [plan.md](plan.md). Hướng dẫn chạy nằm ở [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–5 hoàn tất.** Console theo plan §6 GĐ 5: relay + session token (từ GĐ 0),
noVNC, xterm.js + term-attach, tab console trên guest **và** cửa sổ tách, toolbar
(Ctrl-Alt-Del, fullscreen, reconnect), node shell, SPICE `.vv`, mock RFB + fake shell
trên mock-server. 222+ test đạt, typecheck desktop và lint sạch.

| Hạng mục | Trạng thái |
|---|---|
| Bộ khung Electron + bảo mật + i18n tiếng Việt | Xong |
| Schema + client 675 endpoint + mock schema-router | Xong |
| Vault / TOFU / TFA / connection pool / IPC | Xong |
| Resource poller + TaskDock + RrdChart + cây tài nguyên | Xong |
| Guest lifecycle GĐ 4 (Hardware, Options, Cloud-Init, wizard, snapshot, clone…) | Xong |
| **Relay console loopback + token một lần** | Xong (GĐ 0, giữ) |
| **Upstream session** POST termproxy/vncproxy → WSS vncwebsocket + handshake | Xong |
| **noVNC** (`RFB(target, ws)`) + **xterm.js** term-attach | Xong |
| **Tab Console** trên GuestDrawer + shell node + cửa sổ tách | Xong |
| **SPICE** ghi `.vv` + `shell.openPath` | Xong |
| **Mock** termproxy/vncproxy/spiceproxy + WS upgrade + FakeShell + FakeRfb | Xong |

**Giai đoạn 5 đóng.** Việc tiếp theo là **giai đoạn 6 — Storage** (xem mục 6).

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

**Chưa làm clipboard sync / quality slider** trên toolbar VNC — có Ctrl-Alt-Del, fullscreen,
reconnect, detach. Quality/clipboard có thể bổ sung mỏng sau nếu cần.

---

## 5. Schema / đối chiếu (nhắc lại)

- Node shell VNC dùng `/nodes/{node}/vncshell`, **không** có `/nodes/{node}/vncproxy`.
- Cả term và VNC đều nối `/vncwebsocket` sau khi lấy port+ticket từ proxy.
- `/access/vncticket` tồn tại trong schema 9.2; chưa dùng trong app (relay tự handshake).

---

## 6. Việc tiếp theo — giai đoạn 6 (Storage)

Theo plan.md §6 GĐ 6:

- Storage mọi loại (dir/LVM/ZFS/NFS/CIFS/iSCSI/CephFS/RBD/PBS/BTRFS)
- Content browser + upload/download có tiến trình
- vzdump jobs + lịch, restore wizard, tích hợp PBS

### Điểm nối từ GĐ 5

- `TaskButton` / `PveGrid` / `PveForm` vẫn là trừu tượng chính.
- Mock đã có `GET …/storage` và content list cơ bản — mở rộng handler upload/download.
- Upload lớn phải stream qua main, không qua renderer (plan §8 GĐ 6).

---

## 7–8. Đối chiếu PVE thật & câu hỏi để ngỏ

Giữ nguyên các kết luận đối chiếu GĐ 2–3 trong lịch sử (token console OK, cookie encode,
task UPID thật, rrddata thừa trường vô hại).

Câu hỏi còn lại:

1. **Ký số Windows** — EV/OV trước phát hành.
2. Icon riêng (đang dùng mặc định Electron).
3. Clipboard/quality VNC — có làm mỏng trong GĐ 5 hay để sau.
