# Proxmox VE Manager

Ứng dụng desktop (Windows) quản lý Proxmox VE với mục tiêu đầy đủ tính năng như web UI gốc.

> **Trạng thái: Giai đoạn 0 — bộ khung.** Hiện có shell giao diện, hạ tầng i18n tiếng Việt,
> và đường đi console đã được kiểm chứng đầu-cuối bằng shell giả lập. Chưa kết nối được
> Proxmox thật; phần đó thuộc giai đoạn 1 và 2.

## Chạy thử

```bash
npm install
```

Electron 43 **không còn tự tải binary** qua `postinstall` (họ đã bỏ install script), nên
sau lần cài đầu tiên phải chạy thêm:

```bash
node node_modules/electron/install.js
```

Sau đó:

```bash
npm run dev
```

Vào mục **Console** ở thanh bên để mở shell giả lập. Gõ `help` để xem lệnh, và thử gõ
tiếng Việt có dấu — đó chính là phép thử cho phần đóng khung UTF-8.

## Các lệnh khác

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy app ở chế độ phát triển, có HMR cho renderer |
| `npm test` | Chạy toàn bộ test (giao thức termproxy + tích hợp relay) |
| `npm run typecheck` | Kiểm tra kiểu cho cả main/preload và renderer |
| `npm run build:win` | Đóng gói installer NSIS vào `apps/desktop/release/` |
| `npm run lint` | Kiểm tra mã nguồn |

Kiểm tra nhanh xem app có khởi động sạch không (dùng được trong CI):

```bash
cd apps/desktop && PVE_SMOKE_TEST=1 npx electron .
```

Lệnh này nạp renderer, thu mọi cảnh báo và lỗi của console — bao gồm vi phạm CSP —
rồi thoát với mã 0 nếu sạch, mã 1 nếu có vấn đề.

## Cấu trúc

```
packages/pve-ipc/        Hợp đồng IPC dùng chung, chỉ type
apps/desktop/src/main/   Tiến trình main: mạng, credential, relay console
apps/desktop/src/preload Cầu contextBridge, cố ý giữ mỏng
apps/desktop/src/renderer Giao diện React, chạy sandbox không có Node
apps/desktop/src/shared/ Mã dùng chung giữa main và renderer
```

## Vài quyết định đã chốt và lý do

**Toàn bộ mạng đi qua main process.** Proxmox API không gửi CORS header, nhưng trong
Electron điều đó không thành vấn đề vì main gọi thẳng bằng Node. Quan trọng hơn:
renderer không bao giờ thấy credential, ticket, hay địa chỉ host — nó chỉ cầm một
`connectionId` dạng opaque. CSP cố ý **không** cho phép renderer kết nối tới host
Proxmox; nếu thấy vi phạm CSP ở `connect-src` thì đó là dấu hiệu có code đang đi tắt.

**Console dùng relay trong main, không nối thẳng từ renderer.** Endpoint `/termproxy`
của Proxmox kiểm tra header `Referer`, mà Chromium không cho đặt header trên WebSocket
handshake. Thêm nữa cookie jar của Electron ghi đè header `Cookie`, và với nhiều cluster
thì các jar đụng nhau vì cùng tên `PVEAuthCookie`. Relay trong main giải quyết cả ba,
và noVNC nhận thẳng đối tượng `WebSocket` đang sống nên không bao giờ tự dựng URL.

**Ghim Vite 7, không lên 8.** `electron-vite@5` chỉ nhận `vite ^5 || ^6 || ^7`. Ngoài ra
Vite 8 dùng Rolldown, vốn từ chối top-level `await` trong `@novnc/novnc`.

**Không dùng `@xterm/addon-attach`.** Giao thức termproxy bất đối xứng: chiều gửi phải
đóng khung `0:<số byte>:<dữ liệu>`, chiều nhận là byte thô. Addon nối thô cả hai chiều
nên làm hỏng chiều gửi. Xem `src/shared/term-protocol.ts`.

**Số byte trong khung là byte UTF-8, không phải `String.length`.** Nhầm chỗ này thì gõ
tiếng Việt có dấu sẽ vỡ ký tự. Đây là lý do có bộ test riêng cho phần này.

## Chưa làm

- Kết nối Proxmox thật (giai đoạn 1–2)
- Chưa ký số installer, nên Windows SmartScreen sẽ cảnh báo khi cài
- Chưa có icon riêng, đang dùng icon mặc định của Electron
