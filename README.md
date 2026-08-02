# Proxmox VE Manager

Ứng dụng desktop (Windows) quản lý Proxmox VE với mục tiêu đầy đủ tính năng như web UI gốc.

> **Trạng thái: hết giai đoạn 6 (Storage) trên nhánh này** (GĐ 5 Console có thể còn ở PR riêng).
> Bộ khung Electron, client **675 endpoint**, mock, vault/TOFU/TFA, cây tài nguyên + TaskDock
> + RRD, guest lifecycle GĐ 4. Storage GĐ 6: content browser, upload stream qua main (tiến trình
> /huỷ), download-url, vzdump + lịch backup, restore, CRUD storage + scan, fixture NFS/PBS.

## Thử luồng đầy đủ

Chạy mock server rồi mở app, vào tab **Kết nối** → **Thêm kết nối**:

```bash
npm run dev:mock
```

Rồi trong app (một terminal khác `npm run dev`), thêm kết nối tới `127.0.0.1:8006`,
tài khoản `root@pam`, mật khẩu bất kỳ (trừ `sai`). App sẽ hiện dialog xác nhận vân tay
chứng chỉ tự ký — bấm tin tưởng — rồi cây tài nguyên bên trái hiện node/VM/container thật
từ mock, cập nhật mỗi 3 giây. Bấm vào một guest để mở khung chi tiết có ba tab: **Tổng quan**
(biểu đồ CPU/RAM, nút Khởi động/Tắt máy/Khởi động lại — bấm sẽ mở một tác vụ, hiện ngay
trong dock nhật ký tác vụ ở đáy màn hình với log chạy trực tiếp), **Phần cứng** (bảng cấu
hình thô, chỉ đọc), và **Snapshot** (tạo snapshot mới, rollback hoặc xóa snapshot đã có —
mỗi thao tác cũng mở một tác vụ theo dõi được).

Thử tài khoản `tfa@pve` để xem luồng nhập OTP (mã `123456`).

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

## Máy chủ Proxmox giả lập

Chưa có phần cứng thật thì đây là môi trường phát triển chính:

```bash
npm run dev:mock
```

Nó chạy ở `https://127.0.0.1:8006` với chứng chỉ tự ký, phục vụ **toàn bộ 675 endpoint**
lấy từ schema chính thức của Proxmox VE 9.2.

| | |
|---|---|
| Đăng nhập | Tên bất kỳ, mật khẩu bất kỳ **trừ** chuỗi `sai` |
| Tài khoản có 2FA | `tfa@pve`, mã OTP giả lập `123456` |
| API Token | `root@pam!automation=00000000-1111-2222-3333-444444444444` |

Endpoint nào chưa có hành vi thật vẫn trả lời đúng hình dạng `returns` nhờ bộ sinh tự
động, nên dựng được giao diện cho Ceph hay HA từ trước khi viết logic cho chúng.

API điều khiển (ngoài `/api2`, chỉ dành cho phát triển):

```bash
curl -k -X POST https://127.0.0.1:8006/__mock/node/pve2/offline -H 'Content-Type: application/json' -d '{"offline":true}'
```

Còn có `/__mock/reset`, `/__mock/latency`, `/__mock/fail`, `/__mock/state`. Đây là cách
dựng giao diện cho các trạng thái hỏng hóc khi không có cụm máy thật để phá.

## Các lệnh khác

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy app ở chế độ phát triển, có HMR cho renderer |
| `npm run dev:mock` | Chạy máy chủ Proxmox giả lập |
| `npm test` | Chạy toàn bộ test (121 bài) |
| `npm run typecheck` | Kiểm tra kiểu cho cả main/preload và renderer |
| `npm run build:win` | Đóng gói installer NSIS vào `apps/desktop/release/` |
| `npm run lint` | Kiểm tra mã nguồn |
| `npm run schema:fetch` | Tải lại `apidoc.js` từ Proxmox |
| `npm run schema:generate` | Sinh lại client có kiểu từ schema |

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
