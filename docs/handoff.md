# Bàn giao — giữa giai đoạn 4

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải** — tức là
phần kiến thức không đọc ra được từ mã nguồn.

Kế hoạch tổng thể đầy đủ nằm ở [plan.md](plan.md). Hướng dẫn chạy nằm ở [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0, 1, 2, 3 hoàn tất. Giai đoạn 4 gần xong** — Hardware đầy đủ (kể cả CD/USB/
PCI/EFI), Options, wizard VM/CT, clone/migrate/resize. 193 test đạt, typecheck và lint sạch.

| Hạng mục | Trạng thái |
|---|---|
| Bộ khung Electron + bảo mật (sandbox, CSP) + i18n tiếng Việt | Xong, giai đoạn 0 |
| Relay console loopback + giao thức termproxy | Xong, 25 test |
| Schema chuẩn hoá + client sinh tự động (675 endpoint) | Xong, giai đoạn 1 |
| Mock server định tuyến theo schema + contract test | Xong, giai đoạn 1 |
| HTTPS transport ghim vân tay chứng chỉ + vault + connection pool + IPC | Xong, giai đoạn 2 |
| UI quản lý nhiều kết nối + dialog cert TOFU + luồng TFA | Xong, giai đoạn 2 |
| **Resource poller trong main** (ref-count theo connectionId) | Xong, 4 test |
| **Task tracker tự động** — theo dõi mọi UPID mà request trả về | Xong, 5 test |
| **Cây tài nguyên** (Datacenter → Node → VM/CT/Storage) + lọc | Xong |
| **`<TaskButton>` + `<TaskDock>`** — bắn hành động, log trực tiếp | Xong |
| **`<RrdChart>`** (uPlot) + `<GuestDrawer>` xem nhanh guest | Xong |
| **Mock: snapshot POST/DELETE/rollback + rrddata thật** | Xong, 15 test |
| **`<PveGrid>` / `<PveForm>`** — hai trừu tượng cốt lõi giai đoạn 4 | Xong, giai đoạn 4 phần 1 |
| **Trang tổng quan VM/CT** (Dashboard) đọc từ store `resources`, không poll trùng | Xong |
| **Guest detail có tab**: Tổng quan / Phần cứng / Snapshot | Xong |
| **Snapshot UI đầy đủ**: tạo/liệt kê/rollback/xóa qua `PveGrid`+`PveForm`+`TaskButton` | Xong |
| **Tab Hardware editable**: CPU/RAM, đĩa, mạng (thêm/sửa/xóa) + form tái sử dụng cho wizard | Xong |
| **Mock PUT config**: `delete=` CSV + sync `cpus`/`maxmem`; `type=vm` = qemu∪lxc | Xong |
| **Mock POST tạo VM** (`qmcreate`) / **CT** (`vzcreate`) ghi guest vào world sau task | Xong |
| **Wizard tạo VM 8 bước** + **wizard tạo CT 7 bước** (Dashboard → Tạo mới) | Xong |
| **Hardware nâng cao** CD/USB/audio/serial/PCI/EFI-TPM | Xong |
| **Tab Options** (onboot/startup/agent/…) | Xong |
| **Clone / migrate / resize** (mock + UI GuestOps) | Xong |
| **Picker ISO** (wizard VM) / **picker vztmpl** (wizard CT) | Xong |

Cả bốn nhánh xác thực (ticket, token, TFA, trust-on-first-use chứng chỉ) đã được kiểm
đầu-cuối với mock HTTPS tự ký trong `connection-pool.test.ts` từ giai đoạn 2.

**Còn mỏng trong GĐ 4:** cloud-init form riêng, move-disk UI, cây snapshot lồng nhau,
template convert, quyền/ACL theo guest, E2E Playwright. Xem mục 6.

**Chưa kiểm bằng tương tác desktop thật.** Xác nhận bằng 193 test tự động, typecheck, lint.
Nên đối chiếu bằng tay / Playwright trước khi coi GĐ 4 đóng.

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

### `apidoc.js` KHÔNG phải một tệp JSON

Nó có dạng `const apiSchema = [ …4.2 MB… ]` rồi **tiếp theo là 22 KB mã ExtJS** của trang
API viewer. Không cắt được theo ký tự cuối tệp — phải quét dấu ngoặc cân bằng có tôn trọng
chuỗi và ký tự escape. Xem `packages/pve-schema/src/extract.ts`.

### Node từ chối cú pháp TypeScript không xoá được

Node chạy `.ts` bằng cách **xoá kiểu**, nên `constructor(private readonly x)`, `enum` và
`namespace` đều gây lỗi `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` lúc chạy, với thông báo không
gợi ý gì về nguyên nhân. Đã bật `erasableSyntaxOnly: true` trong `tsconfig.base.json` để
trình biên dịch chặn trước. Đừng tắt cờ đó.

Cũng vì cơ chế xoá kiểu, mọi import tương đối **bắt buộc ghi rõ đuôi `.ts`** (`allowImportingTsExtensions`).

### Fastify không tự phân tích form-urlencoded

Proxmox nhận tham số dưới dạng `application/x-www-form-urlencoded`, **không** nhận JSON body.
Fastify không có sẵn bộ phân tích cho kiểu này, và thiếu nó thì mọi POST trả 415 với thông
báo chẳng nói gì về nguyên nhân. Đã thêm trong `apps/mock-server/src/index.ts`.

### Tra bảng endpoint phải dùng `Object.hasOwn`

`PVE_PATHS[path]` trần sẽ trả về thứ gì đó cho `__proto__`, `constructor`, `toString` — và
bộ kiểm danh sách trắng của IPC coi như hợp lệ. Có test canh riêng cho việc này.

### Không đặt `as const` lên bảng chuỗi i18n

`as const` biến mỗi giá trị thành kiểu literal đúng chuỗi tiếng Việt đó, khiến bản dịch tiếng Anh
không bao giờ gán được (29 lỗi biên dịch). Bỏ `as const` thì khoá vẫn được suy luận đầy đủ — đó là
thứ `t()` cần — còn giá trị nới thành `string`.

### `rejectUnauthorized: false` VÔ HIỆU HÓA `checkServerIdentity`

Cái bẫy nguy hiểm nhất giai đoạn 2. Để ghim vân tay chứng chỉ tự ký, thoạt nhìn có vẻ đúng khi
đặt `rejectUnauthorized: false` (bỏ qua kiểm CA) rồi so vân tay trong `checkServerIdentity`. Nhưng
khi `rejectUnauthorized` là false, Node **bỏ qua luôn** `checkServerIdentity` — nên cert sai vẫn
lọt, và việc ghim vân tay chỉ trông như chạy. Phải kiểm vân tay ở **tầng socket** (`secureConnect`,
`getPeerCertificate`). Xem `https-transport.ts` → `verifyPinnedSocket`. Có test bắt đúng lỗi này.

### Từ chối `AbortSignal` đã abort sẵn phải reject, không phải destroy-rồi-return

Trong transport thủ công bằng `node:https`, nếu signal đã abort trước khi gửi, gọi `req.destroy()`
rồi `return` khỏi executor mà **không** `reject()` thì promise không bao giờ settle → treo tới
timeout. Phải `reject()` trước.

### `window.pve` là bridge phẳng, không lồng `pve.pve`

Giai đoạn 0 lỡ đặt `request/cancel/onEvent` trong một khoá `pve` lồng bên trong object expose dưới
tên `pve`, thành `window.pve.pve.request`. Đã làm phẳng ở giai đoạn 2: mọi thứ ở top level —
`window.pve.request`, `window.pve.vault`, `window.pve.console`, `window.pve.onEvent`.

### Node từ chối parameter property (nhắc lại, dễ tái phạm)

`erasableSyntaxOnly` đã bật, nhưng khi viết lớp mới rất dễ gõ `constructor(private readonly x)`
theo quán tính. Trình biên dịch sẽ báo TS1294. Khai báo field riêng rồi gán trong thân constructor.

### Side effect (hiện thông báo, gọi callback) không được đặt trong thân render

`TaskButton` cần báo kết quả đúng một lần khi task chuyển sang `done`. Bản đầu tay gọi
`message.success()`/`onDone?.()` **trực tiếp trong thân component**, bọc trong `if (... && !reported) { setReported(true); ... }`. React cho phép gọi `setState` có điều kiện trong render để suy trạng thái phái sinh (mẫu "adjusting state" trong tài liệu React), nhưng side effect thật (hiện thông báo, gọi callback ra ngoài) thì **không** — render phải thuần túy. ESLint `react-hooks` bắt được ngay. Sửa bằng cách chuyển vào `useEffect`, và dùng `useRef` (không phải `useState`) để đánh dấu "đã báo" — vì bản thân cờ đó không cần kích hoạt render nào, chỉ để chặn effect chạy lại lần hai.

### Lỗi TS2344 (constraint generic) che luôn lỗi "unused variable" thật

`PveGrid<T>`/`PveForm<T>` ràng buộc `T extends Record<string, unknown>`. Truyền một interface
phẳng không có index signature (`interface Row { name: string }`) làm generic instantiation thất
bại với TS2344 — nhưng tsc còn báo thêm một loạt lỗi TS6133 "declared but never read" cho những
biến/import **rõ ràng có dùng** trong cùng file (ví dụ `TaskButton`, `Tag` dùng ngay trong JSX bên
dưới). Đây không phải hai lỗi độc lập: khi generic instantiation lỗi, phần thân sau đó không được
typecheck đầy đủ nên các usage "biến mất" khỏi mắt tsc. Đừng đi sửa từng cái TS6133 — thêm
`[key: string]: unknown` vào interface trước, rồi typecheck lại; phần lớn TS6133 tự hết.

### `rejectUnauthorized: false` cũng ảnh hưởng SNI với địa chỉ IP

`probeCertificate` từng luôn đặt `servername: host`. Với `host` là địa chỉ IP (trường hợp
phổ biến khi thêm kết nối bằng IP thay vì tên miền), Node cảnh báo SNI không được phép là IP
theo RFC 6066. Đã thêm kiểm tra bỏ qua `servername` khi host là IP.

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

**Không dùng Valibot cho việc kiểm tham số.** Kế hoạch định sinh 675 schema Valibot. Thực tế
làm vậy vừa nặng lúc khởi động vừa khó test. Đã thay bằng một bảng metadata gọn (`endpoints.ts`,
mã kiểu một ký tự) cộng một hàm `validateParams` viết tay dùng chung — nhỏ hơn nhiều và chỉ có
một đường mã cần kiểm chứng. `valibot` không còn là dependency.

**Chưa chuyển `fake-shell.ts` sang mock server.** Kế hoạch xếp việc này vào giai đoạn 1, nhưng
console của mock (endpoint `/termproxy` + `/vncwebsocket`) thuộc giai đoạn 5. Chuyển bây giờ sẽ
làm hỏng console demo đang chạy mà không được gì. Fake shell vẫn ở
`apps/desktop/src/main/console/`; sẽ chuyển khi làm console cho mock ở giai đoạn 5.

**Property string: sinh tự động thay vì viết tay 15 model.** Xem mục 5 — Proxmox nhúng sẵn
sub-schema trong `apidoc.js` nên phần lớn sinh được. Chỉ còn ~5 định dạng chỉ-có-tên phải viết
tay, và chưa cần cho tới giai đoạn 4.

**Vault dùng JSON + safeStorage, KHÔNG dùng SQLite (giai đoạn 2).** Kế hoạch nói `better-sqlite3`.
Nhưng chỉ có vài chục kết nối, không cần SQL, và better-sqlite3 là native module phải rebuild theo
ABI của Electron — một nguồn phức tạp lớn không đáng. Đã dùng một tệp `vault.json` trong `userData`,
secret mã hóa bằng `safeStorage` (DPAPI) lưu base64. Encryptor được trừu tượng hóa nên vault test
được không cần Electron. `better-sqlite3` chưa cài; không cần cho tới khi có nhu cầu truy vấn thật.

**Cert store gộp vào vault, không tách riêng.** Với ghim theo từng kết nối, lưu vân tay ngay trong
bản ghi kết nối là đủ; không cần bảng cert riêng như kế hoạch phác.

**Chưa gỡ console giả lập.** Kế hoạch nói gỡ ở giai đoạn 2. Nhưng console thật (qua relay tới
`/termproxy`) thuộc giai đoạn 5, nên demo vẫn hữu ích để test UI console. Giữ tới giai đoạn 5.

**Bỏ `/cluster/tasks` polling cho task chạy ngoài app (giai đoạn 3).** Kế hoạch (plan.md C.4)
có nhắc poll `/cluster/tasks` mỗi 10s để dock hiện cả task khởi động từ web UI gốc, không chỉ
từ app này. Đã bỏ qua để giữ phạm vi gọn — `TaskTracker` hiện chỉ theo dõi UPID mà chính app
nhận được. Dễ thêm sau: một poller tương tự `ResourcePoller` gọi `/cluster/tasks`, so sánh UPID
mới với danh sách đã biết, gọi `tracker.track()` cho những cái chưa theo dõi.

**Chưa làm `/cluster/log` và tìm kiếm toàn cục (giai đoạn 3).** Plan.md Phase 3 có liệt kê.
Bỏ qua để tập trung vào bộ ba trừu tượng cốt lõi (poller, tracker, TaskButton/RrdChart). Có thể
thêm ở giai đoạn 4 như một tab trong Dashboard mà không ảnh hưởng kiến trúc đã dựng.

**Cây tài nguyên không có chế độ "folder view".** Plan.md nhắc "server view / folder view".
Đã làm server view (Datacenter → Node → Guest) vì đó là mặc định của Proxmox thật; folder view
(nhóm theo pool) để sau, cấu trúc `ResourceTree` hiện đủ đơn giản để thêm chế độ hiển thị thứ hai
mà không cần viết lại.

---

## 5. Những gì phát hiện được về schema Proxmox

Số liệu đã đo trực tiếp, không phải suy đoán:

| | |
|---|---|
| Kích thước `apidoc.js` | 4.277.440 byte (mảng schema chiếm 4.255.316) |
| Đường dẫn riêng biệt | **449** |
| Endpoint (path × method) | **675** — GET 340, POST 173, PUT 83, DELETE 79 |
| Endpoint chặn API Token | **chỉ 5** |
| Tham số có sub-schema property string nội tuyến | 93, gộp lại còn **44 schema riêng biệt** |
| Tên tham số dạng đánh số | 17 (`net[n]`, `scsi[n]`, `mp[n]`, `hostpci[n]`…) |

### API Token dùng được cho console — trái với tài liệu cũ

Kế hoạch ban đầu (dựa trên một bài forum về PVE cũ) khẳng định API Token không mở được
`/termproxy`. **Schema PVE 9.2 nói ngược lại**: cả 11 endpoint console đều có `allowToken: 1`,
và 9.2 còn bổ sung `/access/vncticket` đúng như roadmap nhắc tới.

Đã có test canh giữ khẳng định danh sách này. Nhưng **chưa xác nhận trên server thật** —
`allowtoken` là cổng phân quyền ở tầng API, còn `pvedaemon` trước đây có một lớp kiểm tra
riêng từ chối tên người dùng dạng token. Vẫn phải đối chiếu ở giai đoạn 5.

Dù sao thì WebSocket console vẫn cần cookie `PVEAuthCookie`, mà bắt tay WebSocket không
mang header `Authorization` — nên thực tế console vẫn cần đăng nhập bằng ticket.

### Không suy được endpoint nào trả UPID từ mô tả

Chỉ **6 trên 107** endpoint trả chuỗi có mô tả nhắc tới UPID. Ngay cả `status/start` cũng chỉ
ghi `{"type":"string"}`. Heuristic theo mô tả mà kế hoạch đề xuất gần như vô dụng.

Quy luật đang dùng dựa trên cấu trúc: **không phải GET + trả chuỗi + không có `format` +
không có `description` riêng** → UPID. Cho ra 82 endpoint. Những cái trả chuỗi vì lý do khác
đều tự nhận diện được (`wakeonlan` có `format: mac-addr`, `auth-url` có description riêng);
chỉ `POST /cluster/sdn/lock` phải liệt kê tay.

Đây chỉ là gợi ý cho trình soạn thảo. Lúc chạy vẫn dùng `isUpid()` — định dạng UPID rất đặc
thù nên không nhầm được, và cách đó không lỗi thời khi Proxmox đổi API.

### Property string sinh kiểu được nhiều hơn dự kiến

Kế hoạch định viết tay 15 model. Thực tế Proxmox nhúng sẵn sub-schema cho 93 tham số ngay
trong `apidoc.js` — `net[n]` có 24 khoá, `scsi[n]` 50 khoá, `virtio[n]` 44 khoá. Đã sinh tự
động thành `PVE_PROPERTY_SCHEMAS` (63 KB, 44 schema).

Phần còn phải viết tay là những trường chỉ có **tên** định dạng mà `apidoc.js` không kèm
định nghĩa: `pve-qm-boot`, `pve-qm-hostpci`, `pve-qm-ipconfig`, `pve-qm-cicustom`,
`pve-vm-cpu-conf`. Chưa làm, và chỉ cần khi dựng form phần cứng ở giai đoạn 4.

Cơ chế **bí danh** trong sub-schema là chỗ dễ sai nhất: `net` khai báo
`{"e1000": {"alias":"macaddr","keyAlias":"model"}}`, nghĩa là `net0: "e1000=AA:BB:…"` phải
nở thành `model=e1000` cộng `macaddr=AA:BB:…`. Không xử lý thì phân tích card mạng ra sai
hoàn toàn. Có test riêng.

---

## 6. Việc tiếp theo — phần còn lại của giai đoạn 4

Mục tiêu: **quản lý VM (QEMU) và LXC đầy đủ** — giai đoạn lớn nhất theo plan.md. Phần lớn
hạng mục plan §6 GĐ 4 đã xong; còn cloud-init/move-disk/E2E và vài góc mỏng.

**Đã xong (gần đủ GĐ 4 theo plan.md):**
1. `<PveGrid>` / `<PveForm>` + Dashboard từ store `resources`.
2. `GuestDrawer`: Tổng quan (+ GuestOps) / Phần cứng / Snapshot / Options.
3. Hardware: CPU/RAM/đĩa/mạng + CD/USB/audio/serial/PCI/EFI-TPM.
4. Wizard VM (8) + CT (7); picker ISO / vztmpl từ storage content.
5. Mock: PUT config, qmcreate/vzcreate, qmclone/vzclone, qmigrate/vzmigrate, qmresize/vzresize.
6. Clone / migrate / resize UI trên overview.

**Còn lại (làm mỏng hoặc sang GĐ sau):**
7. Cloud-init form riêng; move-disk / move_volume UI; convert template.
8. Cây snapshot lồng nhau (`parent`) + clone-from-snapshot.
9. Quyền/ACL theo guest; lịch sử task theo guest.
10. Playwright `_electron` E2E (plan §8): tạo → start → snapshot → rollback → xóa.

Mock cần bổ sung dần theo từng nhóm tính năng — endpoint nào chưa có handler riêng vẫn trả lời
hợp lệ nhờ auto-faker, nên UI dựng được trước khi viết hành vi thật cho mock.

### Điểm nối đã có sẵn cho phần còn lại của giai đoạn 4

- `TaskButton` xử lý mọi hành động trả UPID — clone/migrate/resize dùng lại thẳng, không cần viết
  lại logic theo dõi. Đã chứng minh lại với snapshot (rollback/xóa trong `SnapshotTab`).
- `PveGrid<T>` nhận `connectionId`/`method`/`path`/`params`/`columns`/`rowKey`, tự `useQuery` +
  hiện lỗi + ô tìm kiếm tùy chọn. CHỈ dùng cho endpoint gọi theo yêu cầu (snapshot, storage
  content, users…) — KHÔNG dùng cho dữ liệu đã có qua push-event (cây tài nguyên, danh sách guest
  toàn cụm), kẻo tạo poll trùng. Xem `renderer/routes/Dashboard.tsx` để thấy cách đọc thẳng từ
  store `resources` thay vì PveGrid trong trường hợp đó.
- `PveForm<T>` nhận `onFinish` tự do (không cố định method/path một-một, vì một form có thể gộp
  nhiều property string thành một PUT config) — tự bắt lỗi và nối `error.payload.fieldErrors` vào
  `Form.setFields()`. Kiểu tham số generic của `T` cho `PveGrid`/`PveForm` cần index signature
  (`[key: string]: unknown`) để thỏa constraint — quên khai sẽ ra lỗi TS2344 (xem mục 2).
- `useSelection` store (guest đang chọn) đã có; wizard/tab Hardware có thể dùng chung hoặc tách
  store riêng nếu cần trạng thái phức tạp hơn (đang sửa dở, chưa lưu…).
- `pveRequest`/`pveQueryKey` trong `renderer/lib/pve.ts` là mẫu chuẩn cho mọi lời gọi mới.
- Property-string codec (`parsePropertyString`/`formatPropertyString`/`propBool`/`parseSize`)
  trong `@pve/api` đã test kỹ với dữ liệu thật (giai đoạn 1 và đối chiếu) — dùng thẳng cho form.
  `formatPropertyString` đảo bí danh mạng khi ghi. Form Hardware ở
  `renderer/features/resources/hardware/` sẵn sàng tái dùng cho wizard.
- **Bẫy QEMU `memory`:** schema khai báo type chuỗi (`t:"s"`), khác LXC (integer). Gửi số
  từ `InputNumber` sẽ bị `validateParams` từ chối — phải `String(memory)` với QEMU.
- **Wizard create:** guest mock chỉ xuất hiện **sau** khi task `qmcreate` xong — đừng giả
  định list/resources cập nhật ngay khi POST trả UPID. Remount wizard bằng `key` khi mở
  lại (tránh reset draft trong `useEffect` — eslint `set-state-in-effect`).

---

## 7. Đối chiếu với Proxmox thật (PVE 9.2.2, host đơn lẻ)

Đã đối chiếu client sinh tự động và mock với một server PVE **9.2.2** thật. Kết quả:

**Schema ổn định trong dòng 9.2.x.** apidoc.js của 9.2.2 khớp **hoàn toàn** bản ghim 9.2.1 —
449 đường dẫn, 675 endpoint, không lệch một đường nào. Bản schema đã commit dùng được cho
cả 9.2.1 và 9.2.2.

**Client sinh tự động chạy đúng với server thật**, không chỉ với mock. Gọi ~10 endpoint GET
(`/version`, `/cluster/resources`, `/nodes`, node status, danh sách + config guest, storage,
rrddata, tasks) đều parse đúng. Property string codec phân tích đúng cấu hình LXC thật
(`rootfs`, `net0` với `hwaddr`). UPID nhận diện đúng. Đây là kiểm chứng độc lập — client và
mock cùng xây từ một schema nên có nguy cơ "cùng sai"; server thật loại bỏ nghi ngờ đó.

**`/version` cần đăng nhập trên thật** (trả 401), mock từng để public. Đã sửa — chỉ
`POST /access/ticket` và `GET /access/domains` là public, khớp thật.

**Node status thật giàu trường hơn mock** (`boot-info`, `ksm`, `swap`, `current-kernel`,
`memory.available`…). Client không lỗi vì hầu hết là optional, nhưng nên làm giàu fixture
mock dần khi dựng các màn hình tương ứng.

### API Token MỞ ĐƯỢC console — câu hỏi để ngỏ #1 và #2 đã giải quyết

Đã kiểm dứt điểm bằng token test (tạo rồi xóa): trên PVE 9.2.2, API Token gọi được
`POST /nodes/{node}/termproxy`, `/lxc/{vmid}/termproxy`, `/lxc/{vmid}/vncproxy` (đều 200),
**và mở được cả WebSocket `/vncwebsocket`** kèm bắt tay thành công (nhận `OK`). Tài liệu
forum cũ nói `pvedaemon` từ chối token là **đã lỗi thời** với 9.2.

Hai hệ quả kiến trúc:

1. **Củng cố relay-in-main.** WebSocket console mở được bằng token *chỉ khi* handshake mang
   header `Authorization` — mà trình duyệt **không** đặt được header trên WebSocket, chỉ Node
   (`ws` trong main) làm được. Nếu renderer nối thẳng thì token vô dụng cho console. Đây là
   thêm một lý do cứng cho kiến trúc relay trong main.
2. **UX đơn giản hơn kế hoạch.** Không cần bắt một kết nối chỉ-token phải kèm mật khẩu để
   dùng console. Một token là đủ cho cả API lẫn console. Bỏ được ràng buộc "kết nối cần cả
   hai loại credential" mà kế hoạch lo ngại.

*(Ticket vẫn cần cho luồng đăng nhập người dùng thường và cho TFA — token chỉ là lựa chọn
thêm, không thay thế.)*

### Đối chiếu giai đoạn 2 với PVE 9.2.2 thật (đọc lẫn ghi)

Đã chạy toàn bộ tầng giai đoạn 2 (Vault + ConnectionPool + transport ghim cert) với server
thật, credential do người dùng cấp qua chat, được toàn quyền test. Kết quả:

**Ghim vân tay chứng chỉ thật hoạt động.** Probe đọc đúng cert tự ký của Proxmox
(subject `pve.localdomain`, issuer `Proxmox Virtual Environment`). Ghim SAI vân tay → transport
chặn với lỗi FINGERPRINT_MISMATCH. Ghim đúng → kết nối được. Đây là kiểm chứng độc lập rằng
bản sửa "kiểm ở tầng socket" (mục 2) đúng — với cert thật, không chỉ mock.

**Cookie URL-encode + CSRF thật đều đúng.** Ticket thật chứa `:` và `=`; mọi GET thành công
xác nhận cookie mã hóa đúng. POST (tạo snapshot) và DELETE (xóa snapshot) thành công xác nhận
CSRF token được gửi đúng cho thao tác ghi — nếu sai server trả 401.

**Task tracking với UPID thật hoạt động** — quan trọng cho giai đoạn 3. Tạo/xóa snapshot và
reboot trả về UPID thật; `parseUpid` + `upidResourceKind` phân tích đúng; poll
`/tasks/{upid}/status` tới `stopped` với `exitstatus=OK` và đọc được log. Mọi thao tác đã khôi
phục (snapshot xóa sạch, CT về `running`).

**Phát hiện cho giai đoạn 3: tên task LXC thật.** Type task của LXC là `vzsnapshot`,
`vzdelsnapshot`, `vzreboot`, `vzstart`, `vzstop` — KHÔNG phải `qmsnapshot` như mock đang dùng
lẫn lộn. `upidResourceKind` xử lý đúng nhờ prefix `vz`, nhưng **mock server chưa có handler
snapshot POST/DELETE** (đang dùng auto-faker), và task engine của mock nên dùng đúng các tên
này. Khi làm task tracking giai đoạn 3, cập nhật `apps/mock-server/src/tasks/engine.ts` và thêm
handler snapshot để test sát thực tế hơn.

### Đối chiếu giai đoạn 3 với PVE 9.2.2 thật (poller, task tracker, rrddata)

Sau khi dựng xong resource poller, task tracker, và rrddata cho mock, đã chạy lại với server
thật để kiểm cả kiến trúc mới lẫn bản sửa từ phát hiện giai đoạn 2 ở trên.

**`ResourcePoller` nhận đúng nhịp đầu tiên** với dữ liệu thật (5 dòng: 1 node, 1 CT, 2 storage,
đúng như server đang có).

**`vzsnapshot` được xác nhận lần thứ hai, độc lập.** Tạo snapshot thật qua `TaskTracker` trả về
`UPID:pve:...vzsnapshot:100:root@pam:` — khớp chính xác phát hiện ở giai đoạn 2, và lần này qua
đúng luồng mà `GuestDrawer`/`TaskButton` sẽ dùng (không phải gọi tay qua curl). Task tracker theo
đúng ba pha `started → running → done(OK)`. Snapshot test đã xóa sạch sau khi xong.

**rrddata thật có nhiều trường hơn schema/mock dự kiến, nhưng vô hại.** Node thật trả về các
trường PSI mới của kernel (`pressurememorysome`, `pressurecpufull`…), `swaptotal`, `arcsize`…
mà bản sinh tự động và mock của ta không có. `RrdChart` chỉ đọc đúng khóa nó cần (`cpu`, `mem`,
`maxmem`, `disk`, `maxdisk`) nên các trường lạ bị bỏ qua an toàn — không cần cập nhật gì, nhưng
đáng ghi lại: **đừng giả định `Object.keys(rrdPoint)` là danh sách đóng**, code phải luôn đọc
theo tên khóa cụ thể, không lặp qua toàn bộ object.

**Số điểm dữ liệu thật thay đổi theo lịch sử tích lũy, không cố định 70.** Node thật trả 59 điểm
cho `timeframe=hour` (ít hơn 70 vì RRD chưa đầy do node mới khởi động lại gần đây), trong khi
mock luôn trả đúng 70 (dữ liệu tổng hợp, không có khái niệm "chưa đủ lịch sử"). `RrdChart` không
giả định số điểm cố định nên không bị ảnh hưởng — nhưng nếu sau này viết code giả định `length===70`
ở đâu đó thì sẽ sai với dữ liệu thật.

## 8. Câu hỏi để ngỏ

1. **Advisory `PSA-2026-00014-1`** — nên đọc trước giai đoạn 5. Nhưng đối chiếu trên đã cho
   thấy luồng `/vncwebsocket` (đúng cái web UI gốc dùng) hoạt động bình thường trên 9.2.2, kể
   cả với token, nên nhiều khả năng không bị ảnh hưởng. Rủi ro đã giảm đáng kể.
2. **Ký số Windows** — quyết định chứng chỉ EV hay OV trước khi phát hành. Hiện installer chưa
   ký, SmartScreen sẽ cảnh báo.
3. Chưa có icon riêng, đang dùng icon mặc định của Electron.
4. Có sẵn một server PVE 9.2.2 thật (host đơn lẻ, 1 LXC) để đối chiếu ở các giai đoạn sau.
   Địa chỉ và credential do người dùng cấp qua chat, **không lưu trong repo**.
