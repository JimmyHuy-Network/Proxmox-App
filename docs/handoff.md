# Bàn giao — kết thúc giai đoạn 0

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải** — tức là
phần kiến thức không đọc ra được từ mã nguồn.

Kế hoạch tổng thể đầy đủ nằm ở [plan.md](plan.md). Hướng dẫn chạy nằm ở [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0 hoàn tất.** Bộ khung chạy được, đóng gói được, và đường đi console đã kiểm chứng.

| Hạng mục | Trạng thái |
|---|---|
| npm workspaces + TypeScript strict | Xong |
| Electron 43 + electron-vite 5 + Vite 7 + React 19 | Xong |
| Cấu hình bảo mật (contextIsolation, sandbox, CSP, chặn điều hướng) | Xong, có kiểm tự động |
| antd 6 theme tối gọn + TanStack Router + i18n tiếng Việt | Xong |
| Giao thức termproxy (mã hoá/giải mã khung) | Xong, 15 test |
| Relay console loopback + token dùng một lần | Xong, 10 test tích hợp |
| Fake shell (dùng thay Proxmox thật) | Xong |
| xterm.js nối qua term-attach tự viết | Xong |
| electron-builder ra installer NSIS | Xong, 96 MB |

**Chưa có gì kết nối được Proxmox thật.** Toàn bộ tầng HTTP, xác thực, và kho credential
thuộc giai đoạn 1–2.

### Kiểm chứng lại toàn bộ

```bash
npm test && npm run typecheck && npm run lint
```

```bash
cd apps/desktop && PVE_SMOKE_TEST=1 npx electron .
```

Lệnh thứ hai nạp renderer, thu mọi cảnh báo/lỗi console (gồm cả vi phạm CSP), thoát mã 0
nếu sạch. Dùng được trong CI. Chạy được cả với `npx electron-vite dev` để kiểm chế độ dev.

---

## 2. Những cái bẫy đã vấp — đừng vấp lại

### Electron 43 không còn tự tải binary

Electron đã **bỏ hẳn `postinstall`** (chuyển sang bin `install-electron`). Sau `npm install`
lần đầu, `node_modules/electron/dist/` sẽ trống và `npm run dev` báo lỗi khó hiểu. Phải chạy:

```bash
node node_modules/electron/install.js
```

Đây không phải lỗi cấu hình — đó là thay đổi có chủ đích của Electron để tránh install script.

### Ghim Vite 7, không được lên 8

`electron-vite@5` khai báo peer `vite: ^5 || ^6 || ^7`. Vite 8 còn dùng Rolldown, vốn từ chối
top-level `await` trong `@novnc/novnc/core/util/browser.js`. Hai lý do độc lập, cùng một kết luận.
Version đã ghim cứng (`"vite": "7.3.6"`, không có dấu `^`).

### preload phải là CommonJS

`sandbox: true` khiến Electron **không nạp được preload dạng ESM**. Vì vậy `apps/desktop/package.json`
cố ý **không** có `"type": "module"`, và `electron.vite.config.ts` ép `format: 'cjs'` cho cả main
lẫn preload. Đổi chỗ này sẽ làm app chết lúc khởi động với lỗi rất mơ hồ.

### Số byte trong khung termproxy là byte UTF-8

`0:<số byte>:<dữ liệu>` — `<số byte>` là **byte UTF-8**, không phải `String.length`.
`"àààà"` có length 4 nhưng chiếm 8 byte. Dùng nhầm `.length` thì server đọc thiếu và mọi ký tự
sau đó lệch hết. Triệu chứng chỉ lộ ra khi gõ tiếng Việt, nên test bằng tiếng Anh sẽ không bắt được.
Xem `apps/desktop/src/shared/term-protocol.ts` và bộ test cạnh nó.

### Không dùng `@xterm/addon-attach`

Giao thức termproxy bất đối xứng: chiều gửi đóng khung, chiều nhận là byte thô. Addon nối thô
cả hai chiều nên làm hỏng chiều gửi. Đã tự viết `renderer/features/console/term-attach.ts`.

### Từ chối token phải xảy ra ở bước HTTP upgrade

**Lỗi đã sửa trong giai đoạn 0.** Ban đầu relay dùng `new WebSocketServer({ port })` rồi gọi
`client.close(4401)` trong sự kiện `connection` — nhưng lúc đó bắt tay đã xong, client vẫn kịp
thấy `open`. Đã chuyển sang `noServer: true` + tự xử lý `server.on('upgrade')`, trả HTTP 401
trước khi socket kịp thành hình. **Đừng quay lại cách cũ.**

### Gắn listener `message` đồng bộ ngay khi tạo WebSocket

Server gửi dữ liệu ngay khi phiên được nối. Khi phản hồi 101 và khung dữ liệu về chung một gói
TCP, `ws` phát `open` rồi phát luôn `message` trong cùng một lượt đồng bộ. Nếu gắn listener ở
microtask sau (`await connect()` rồi mới `socket.on('message')`) thì **luôn** mất những khung đầu tiên.

Mã sản phẩm không dính vì `attachTerminal` được gọi đồng bộ ngay sau `new WebSocket`. Bộ test đã
từng dính và được sửa — xem ghi chú trong `relay-server.test.ts`.

### Không đặt `as const` lên bảng chuỗi i18n

`as const` biến mỗi giá trị thành kiểu literal đúng chuỗi tiếng Việt đó, khiến bản dịch tiếng Anh
không bao giờ gán được (29 lỗi biên dịch). Bỏ `as const` thì khoá vẫn được suy luận đầy đủ — đó là
thứ `t()` cần — còn giá trị nới thành `string`.

---

## 3. Quyết định kiến trúc đã chốt

**Toàn bộ mạng đi qua main process.** Renderer không bao giờ thấy credential, ticket, hay host —
chỉ cầm `connectionId` dạng opaque. CSP cố ý **không** liệt kê host Proxmox trong `connect-src`.
Nếu sau này thấy vi phạm CSP ở đó, đó là dấu hiệu có code renderer đang đi tắt — sửa code, đừng nới CSP.

**Console dùng relay trong main.** Lý do đầy đủ nằm trong khối chú thích đầu
`apps/desktop/src/main/console/relay-server.ts`. Tóm tắt: `/termproxy` kiểm header `Referer` mà
Chromium không cho đặt trên WebSocket handshake; cookie jar Electron ghi đè `Cookie` và đụng nhau
giữa các cluster; TLS tự ký buộc qua `setCertificateVerifyProc` vốn có cache. noVNC nhận thẳng
đối tượng `WebSocket` đang sống nên không bao giờ tự dựng URL — đó là điều làm phương án này chạy được.

**Một kênh IPC chung, không phải 675 kênh.** An toàn kiểu đến từ bản đồ endpoint sinh tự động,
kiểm soát truy cập đến từ danh sách trắng trong main. Hợp đồng nằm ở `packages/pve-ipc/`.
Đã cân nhắc và **loại** `electron-trpc`: thêm một lớp serialization trên mọi lời gọi, mà ta gọi
rất dày (poll resource + poll task), và codegen đã cho sẵn type nên tRPC không mang lại gì thêm.

**antd 6, không dùng ProComponents** (peer của nó chỉ tới antd 5). Mọi grid và form phải đi qua
wrapper tự viết `<PveGrid>` / `<PveForm>` — chưa xây, thuộc giai đoạn 3–4. Đây là seam để nếu
antd 6 có vấn đề thì hạ về antd 5 chỉ là đổi một package.

---

## 4. Chỗ đã làm khác kế hoạch

**Console giả lập chạy cả trong bản đóng gói.** Kế hoạch nói chỉ dev. Nhưng như vậy bản `.exe`
sẽ không có gì để xem ở giai đoạn 0. Fake shell là bộ thông dịch trong tiến trình: không đọc ghi
file, không mở kết nối ra ngoài, vẫn nằm sau relay loopback + token dùng một lần. Rủi ro thực tế
bằng không. **Phải gỡ ở giai đoạn 2** khi đã có quản lý kết nối thật — đã ghi chú `GỠ BỎ` trong
`apps/desktop/src/main/ipc/console.handlers.ts`.

**Chưa cài `better-sqlite3`.** Là native module cần `electron-rebuild`; tới giai đoạn 2 mới dùng.
Không để nó chặn giai đoạn 0. Khi thêm vào, nhớ nó phải nằm ở `dependencies` (không phải dev) để
electron-builder đóng gói kèm.

**Bỏ `exactOptionalPropertyTypes`.** Kế hoạch có liệt kê. Thực tế nó xung đột dày đặc với props
của antd/React và tạo ra rất nhiều `{...(x ? {p: x} : {})}`. Đã giữ `strict` +
`noUncheckedIndexedAccess` (giá trị thật khi phân tích dữ liệu schema) và bỏ cái kia.

**`electron.vite.config.ts` và `electron-builder.yml` đặt trong `apps/desktop/`,** không phải ở gốc
như sơ đồ trong kế hoạch — vì script npm chạy trong thư mục workspace nên công cụ tìm config ở đó.

---

## 5. Việc tiếp theo — giai đoạn 1

Mục tiêu: **schema + client sinh tự động + bộ khung mock server**. Ước lượng 1.5–2 tuần.

### Thứ tự làm

1. **`packages/pve-schema`**
   - `scripts/fetch-apidoc.ts` tải `https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js`
     (đã xác minh: HTTP 200, 4.277.440 byte, `text/javascript`), ghi `raw/` kèm sha256 + phiên bản PVE.
   - `scripts/normalize.ts` bóc tiền tố `const apiSchema = ` và dấu `;` cuối, `JSON.parse`, làm phẳng
     cây thành record theo path, trích `pathParams` từ các đoạn `{...}`.
   - Xuất `generated/pve-9.2.schema.json` — **commit tệp này** để build không cần mạng.
   - `raw/` đã nằm trong `.gitignore`; `generated/` thì không.

2. **`packages/pve-api`** — generator phát ra `paths.ts` (kiểu), `endpoints.ts` (metadata lúc chạy,
   dùng cho danh sách trắng IPC), `validators.ts` (Valibot), `enums.ts`.

3. **Phần viết tay của `pve-api`**: `core/property-string.ts` + model cho ~15 property string quan
   trọng (disk, net, mp, hostpci, usb, serial, boot, ipconfig, startup, agent, numa, smbios1, spice,
   efidisk, tpmstate), `core/upid.ts`, `core/errors.ts`, `core/auth.ts`.

4. **`apps/mock-server`** — Fastify 5, HTTPS cert tự ký, cổng 8006. Router đọc chính
   `pve-9.2.schema.json`. Chuyển `fake-shell.ts` từ `apps/desktop/src/main/console/` sang đây.

### Số liệu đã xác minh về schema

| | |
|---|---|
| URL | `https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js` |
| Kích thước | 4.277.440 byte |
| Mở đầu | `const apiSchema = [` |
| Đường dẫn riêng biệt | **449** |
| Endpoint (path × method) | **675** |
| Khoá của node | `children`, `info`, `leaf`, `path`, `text` |
| Khoá theo method | `allowtoken`, `description`, `method`, `name`, `parameters`, `returns`, `permissions`, `protected`, `proxyto` |

`allowtoken: 0` chính là cách biết endpoint nào **không** dùng được API Token.

### Bẫy đã biết khi map kiểu

- `type: 'boolean'` nhưng **wire format là `0`/`1`** — phải ép kiểu hai chiều.
- Khoá glob `net[n]`, `scsi[n]`, `mp[n]`, `hostpci[n]` → sinh index signature `` [K in `net${number}`]?: string ``.
- Nhiều "object" thực chất là property string (`virtio0: 'local-lvm:vm-100-disk-0,size=32G'`).
  Generator không type nổi — đó là lý do có phần viết tay ở bước 3.
- Proxmox tự nói schema **"không tương thích 100% với JSONSchema"** và API **không đánh version**.
  Luôn giữ lối thoát `client.raw(method, path, params)` không kiểu.

---

## 6. Câu hỏi để ngỏ

1. **Phải đọc advisory `PSA-2026-00014-1` trước khi bắt đầu giai đoạn 5.** PVE 9.2 vá lỗ hổng
   chiếm phiên VNC và roadmap nói client ngoài dùng `vncshell`/`vncproxy` phải thích ứng. Theo câu chữ
   thì chủ yếu ảnh hưởng client nối thẳng cổng TCP VNC thô — thiết kế của ta đi qua `/vncwebsocket`
   giống hệt web UI gốc nên nhiều khả năng không bị. Cần xác nhận.
2. PVE 9.2 đã thêm endpoint xác minh VNC ticket do token sở hữu, dành cho termproxy. Nếu nó cho phép
   API Token mở được terminal thì UX "một kết nối cần cả token lẫn mật khẩu" đơn giản hoá được đáng kể.
3. **Ký số Windows** — quyết định chứng chỉ EV hay OV trước khi phát hành. Hiện installer chưa ký,
   SmartScreen sẽ cảnh báo.
4. Chưa có icon riêng, đang dùng icon mặc định của Electron.
5. Nên dựng **PVE 9 lồng trong Hyper-V** chậm nhất ở giai đoạn 3 để đối chiếu với API thật.
   Mock chắc chắn khác thực tế theo những cách không đoán trước (lỗi 596 của pveproxy, độ trễ proxy
   giữa node, đua tranh quorum, `pvestatd` cũ dữ liệu).
