# Bàn giao — kết thúc giai đoạn 2

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải** — tức là
phần kiến thức không đọc ra được từ mã nguồn.

Kế hoạch tổng thể đầy đủ nằm ở [plan.md](plan.md). Hướng dẫn chạy nằm ở [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0, 1, 2 hoàn tất.** 150 test đạt, typecheck và lint sạch.

| Hạng mục | Trạng thái |
|---|---|
| Bộ khung Electron + bảo mật (sandbox, CSP) + i18n tiếng Việt | Xong, giai đoạn 0 |
| Relay console loopback + giao thức termproxy | Xong, 25 test |
| Schema chuẩn hoá + client sinh tự động (675 endpoint) | Xong, giai đoạn 1 |
| Mock server định tuyến theo schema + contract test | Xong, giai đoạn 1 |
| **HTTPS transport ghim vân tay chứng chỉ + probe cert** | Xong, 8 test |
| **Vault credential** (safeStorage + JSON, không phải SQLite) | Xong, 11 test |
| **Connection pool + máy trạng thái xác thực** | Xong, 10 test tích hợp |
| **Năm kênh IPC + validator danh sách trắng** | Xong |
| **UI quản lý nhiều kết nối** + dialog cert TOFU + luồng TFA | Xong |
| **Bộ chọn cluster ở header + dashboard dữ liệu thật** | Xong (TanStack Query) |

Cả bốn nhánh xác thực (ticket, token, TFA, trust-on-first-use chứng chỉ) đã được kiểm
đầu-cuối với mock HTTPS tự ký trong `connection-pool.test.ts`.

**Chưa làm ở giai đoạn 3:** cây tài nguyên, poller `/cluster/resources` trong main, dock
tác vụ, biểu đồ RRD. Xem mục 6.

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

## 6. Việc tiếp theo — giai đoạn 3

Mục tiêu: **cây tài nguyên, dashboard, hệ thống tác vụ**. Ước lượng 2–3 tuần.

1. **Poller `/cluster/resources` trong main.** Chạy trong tiến trình main (không phải renderer)
   để tiếp tục poll cả khi cửa sổ thu nhỏ. Đẩy kết quả qua kênh `pve:event` (`kind: 'resources'`
   — đã định nghĩa trong `packages/pve-ipc/src/events.ts`). Dùng kênh `pve:stream:start/stop`
   (đã khai báo, chưa nối) để renderer đăng ký/hủy theo kết nối đang xem.
2. **Cây tài nguyên bên trái** thay cho Sider tĩnh hiện tại trong `AppLayout.tsx`. Server view /
   folder view, icon trạng thái, ô lọc. Nạp `huge.json` (8 node/400 guest) để test hiệu năng —
   memoize mạnh, đây là đường nóng nhất.
3. **Dock tác vụ dưới đáy** thay cho Footer tĩnh. Task tracker trong main poll
   `/nodes/{node}/tasks/{upid}/status` + `/log`, đẩy `pve:event` (`kind: 'task'`, `'log-chunk'`).
   Khi task xong, invalidate query key suy từ UPID (parser `parseUpid` + `upidResourceKind` đã có
   trong `@pve/api`).
4. **`<TaskButton>`, `<RrdChart>` (uPlot), `useTask`** — ba trừu tượng nền cho các giai đoạn sau.
5. **Dashboard datacenter/node/guest** đầy đủ hơn (hiện mới có bảng guest cơ bản).

Mock đã sẵn sàng: task engine đổi trạng thái guest KHI task xong, `/tasks/{upid}/log` tôn trọng
con trỏ, và có control API `/__mock/node/:node/offline` để test node chết.

### Điểm nối đã có sẵn cho giai đoạn 3

- `ConnectionPool.request()` trong main là điểm vào mọi lời gọi REST — poller gọi thẳng nó.
- Kênh `pve:event` đã đẩy được `AuthEvent`; thêm `ResourcesEvent`/`TaskEvent` chỉ là mở rộng
  cùng cơ chế (`pushEvent` trong `index.ts`).
- `useConnections` store + `subscribeConnectionEvents` cho thấy mẫu nhận sự kiện ở renderer.
- Dashboard đã dùng TanStack Query với `refetchInterval` — mẫu cho các view poll khác.

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

## 8. Câu hỏi để ngỏ

1. **Advisory `PSA-2026-00014-1`** — nên đọc trước giai đoạn 5. Nhưng đối chiếu trên đã cho
   thấy luồng `/vncwebsocket` (đúng cái web UI gốc dùng) hoạt động bình thường trên 9.2.2, kể
   cả với token, nên nhiều khả năng không bị ảnh hưởng. Rủi ro đã giảm đáng kể.
2. **Ký số Windows** — quyết định chứng chỉ EV hay OV trước khi phát hành. Hiện installer chưa
   ký, SmartScreen sẽ cảnh báo.
3. Chưa có icon riêng, đang dùng icon mặc định của Electron.
4. Có sẵn một server PVE 9.2.2 thật (host đơn lẻ, 1 LXC) để đối chiếu ở các giai đoạn sau.
   Địa chỉ và credential do người dùng cấp qua chat, **không lưu trong repo**.
