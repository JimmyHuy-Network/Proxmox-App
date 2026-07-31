# Proxmox VE Desktop Client — Kế hoạch triển khai

## Context

Bạn muốn một ứng dụng để điều khiển Proxmox VE với **đầy đủ mọi tính năng như web UI gốc**. Thư mục `D:\Work\Proxmox-App` hiện hoàn toàn trống — đây là dự án làm mới từ đầu.

Các quyết định đã chốt cùng bạn:

| Hạng mục | Quyết định |
|---|---|
| Nền tảng | **Electron desktop app**, đóng gói `.exe` cho Windows |
| Phạm vi | Đầy đủ tính năng tương đương web UI (VM/LXC, console, storage, backup, network, firewall, SDN, users, HA, Ceph, replication) |
| Xác thực | **Cả hai**: ticket (username/password + TOTP) và API Token |
| Số cluster | **Nhiều cluster**, chuyển đổi trong app |
| Ngôn ngữ | **Tiếng Việt là chính**, hạ tầng i18n dựng sẵn từ đầu |
| Phiên bản PVE | **Chỉ 9.x**, ghim schema theo 9.2 |
| Môi trường test | **Mock server** là mục tiêu phát triển chính + tài liệu dựng PVE lồng trong Hyper-V |
| Cách làm | Chia giai đoạn, mỗi giai đoạn đều chạy và kiểm thử được |

### Dữ kiện đã xác minh (quyết định phần lớn kiến trúc)

- `https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js` trả HTTP 200, **4.28 MB**, bắt đầu bằng `const apiSchema = [`. Bên trong có **449 đường dẫn / 675 endpoint**. → Viết tay là bất khả thi; **bắt buộc sinh code tự động**.
- `electron-vite@5.0.0` chỉ nhận `vite: ^5 || ^6 || ^7`, trong khi Vite mới nhất là 8.2.0 → **ghim Vite 7**. Vite 8 còn dùng Rolldown vốn từ chối top-level `await` trong `@novnc/novnc` — hai lý do độc lập cùng chỉ về một hướng.
- `@novnc/novnc@1.7.0` có `exports: './core/rfb.js'` (chuỗi đơn) → chỉ import được từ package root.
- `antd@6.5.3` yêu cầu React >= 18; ta dùng React 19.2.8 → hợp lệ, và **không cần** `@ant-design/v5-patch-for-react-19`.
- Proxmox API **không gửi CORS header**, nhưng trong Electron mọi request đi từ main process (Node) nên vấn đề này biến mất hoàn toàn.
- API Token **không mở được** `/termproxy` websocket → console terminal bắt buộc dùng ticket auth.

---

## 1. Kiến trúc tổng thể

Ba tiến trình, ranh giới rõ ràng:

- **Main (Node, đầy đủ quyền)** — tất cả những gì chạm mạng, đĩa, hệ điều hành: HTTPS tới Proxmox, máy trạng thái xác thực, kho credential, pin chứng chỉ TLS, WebSocket relay cho console, polling task và cluster resources.
- **Preload (`contextIsolation: true`)** — bề mặt nhỏ, khoảng 8 hàm. Không chứa logic nghiệp vụ.
- **Renderer (sandbox, không Node)** — chỉ React. Mạng duy nhất renderer tự mở là `ws://127.0.0.1:<port>` tới relay nội bộ.

Nguyên tắc bất di bất dịch: **renderer không bao giờ nhìn thấy credential, ticket, hay địa chỉ Proxmox** — chỉ thấy `connectionId` dạng opaque.

---

## 2. Tech stack (đã ghim phiên bản)

```
electron@43.2.0          electron-vite@5.0.0      vite@7.x  (KHÔNG lên 8)
react@19.2.8             typescript@5.9.3         (KHÔNG dùng 7.0.2: API lập trình chưa ổn định tới 7.1)
antd@6.5.3               @ant-design/icons@6.x
@tanstack/react-query@5.101.4    @tanstack/react-router@1.170.18
uplot@1.6.32 + uplot-react       zustand@5.x  (chỉ cho client state)
@novnc/novnc@1.7.0       @xterm/xterm@6.0.0 + addon-fit/webgl/search/unicode11
ws@8.21.1                undici@8       better-sqlite3@13.0.2
valibot@1.4.2            i18next + react-i18next
fastify@5.11.0 (mock)    electron-builder@26.15.3 + electron-updater
vitest@4 + @playwright/test@1.62.1 (_electron)
```

**Vì sao Ant Design v6:** dự án này là ~90 grid và ~100 form mô phỏng một admin UI ExtJS. Giá trị của thư viện chính là `Table` và `Form`, và antd có bản triển khai miễn phí giàu tính năng nhất — kèm `Tree`, `Tabs`, `Descriptions`, `Transfer`, `Steps`, `Popconfirm` gần như khớp 1:1 với từ vựng giao diện của Proxmox. **Không dùng ProComponents** (peer chỉ tới antd 5); thay vào đó tự viết wrapper mỏng `<PveGrid>` / `<PveForm>`.

**Vì sao uPlot thay vì Recharts:** màn hình RRD hiển thị 4–8 biểu đồ thời gian đồng bộ mỗi guest/node, cộng sparkline trong grid. uPlot vẽ canvas ~1 ms mỗi biểu đồ; Recharts dùng SVG sẽ giật thấy rõ với 8 panel × 1500 điểm ở khung "year".

---

## 3. Cấu trúc thư mục

```
D:\Work\Proxmox-App\
├─ package.json                  # npm workspaces (không cần pnpm)
├─ tsconfig.base.json
├─ electron.vite.config.ts
├─ electron-builder.yml
│
├─ packages/
│  ├─ pve-schema/               # apidoc.js → JSON chuẩn hoá (COMMIT vào git)
│  │  ├─ scripts/fetch-apidoc.ts
│  │  ├─ scripts/normalize.ts
│  │  └─ generated/pve-9.2.schema.json
│  ├─ pve-api/                  # client có kiểu, sinh tự động
│  │  ├─ scripts/generate.ts
│  │  ├─ src/generated/{paths,endpoints,validators,enums}.ts
│  │  └─ src/core/              # viết tay: transport, auth, errors, upid, property-string
│  ├─ pve-ipc/                  # hợp đồng IPC dùng chung (chỉ type)
│  └─ pve-i18n/                 # chuỗi dịch vi/en
│
├─ apps/
│  ├─ desktop/src/
│  │  ├─ main/
│  │  │  ├─ ipc/                # registry, pve.handlers, vault, console, app
│  │  │  ├─ pve/                # connection-pool, pve-connection, http-agent,
│  │  │  │                      # auth/{ticket,token}, task-tracker, resource-poller
│  │  │  ├─ console/            # relay-server, session, term-protocol
│  │  │  ├─ security/           # cert-store (TOFU), vault (safeStorage)
│  │  │  └─ store/              # better-sqlite3 + migrations
│  │  ├─ preload/index.ts
│  │  └─ renderer/
│  │     ├─ routes/             # TanStack Router
│  │     ├─ features/           # qemu, lxc, node, storage, backup, firewall,
│  │     │                      # sdn, access, ha, ceph, cluster, console
│  │     ├─ components/         # PveGrid, PveForm, TaskButton, RrdChart, StatusDot
│  │     └─ hooks/              # usePve, usePveMutation, useTask, useRrd
│  │
│  └─ mock-server/              # Proxmox VE giả lập
│     ├─ src/{router,state,handlers,tasks,ws}/
│     └─ fixtures/*.json
│
└─ docs/nested-pve-hyperv.md    # hướng dẫn dựng PVE 9 thật trong Hyper-V
```

---

## 4. Bốn quyết định kiến trúc then chốt

### 4.1 Sinh code từ `apidoc.js` — quyết định sống còn

Viết tay 675 endpoint là 6–10 tuần công việc bào mòn tinh thần và lỗi thời ngay khi viết xong. Sinh tự động mất 3–5 ngày và cho một client làm mới lại được bất cứ lúc nào.

Pipeline: `fetch-apidoc.ts` tải file → `normalize.ts` bóc tiền tố `const apiSchema =` rồi `JSON.parse`, làm phẳng cây thành record theo path → `generate.ts` phát ra 4 file. **Commit file JSON đã chuẩn hoá** để build không cần mạng.

Sản phẩm sinh ra được dùng lại **ba lần**, đây là lý do khoản đầu tư này đáng giá:
1. `paths.ts` → kiểu cho renderer.
2. `endpoints.ts` → danh sách trắng kiểm tra IPC (chống SSRF).
3. Chính schema đó → **router của mock server**.

Những chỗ dễ sai khi map kiểu, phải xử lý đúng ngay từ đầu:
- `type: 'boolean'` nhưng **wire format là `0`/`1`** — phải ép kiểu hai chiều.
- Khoá dạng glob `net[n]`, `scsi[n]`, `mp[n]`, `hostpci[n]` → sinh index signature `` [K in `net${number}`]?: string ``.
- Nhiều "object" thực chất là **property string** của PVE (`virtio0: 'local-lvm:vm-100-disk-0,size=32G,iothread=1'`). Generator không type nổi. Viết tay `src/core/property-string.ts` + model cho ~15 loại quan trọng nhất (disk, net, mp, hostpci, usb, serial, boot, ipconfig, startup, agent, numa, smbios1, spice, efidisk, tpmstate). Đây là phần viết tay đáng kể duy nhất, khoảng 1 tuần.
- `allowtoken: 0/1` trong schema chính là cách biết endpoint nào **không** dùng được API Token.

Luôn giữ lối thoát `client.raw(method, path, params)` không kiểu, để type sinh sai không bao giờ chặn người dùng.

### 4.2 IPC: một kênh chung, không phải 675 kênh

Chỉ tạo **5 kênh**: `pve:request`, `pve:stream:start`, `pve:stream:stop`, `pve:event` (main→renderer, đa hợp), và `app:*`. An toàn kiểu đến từ **bản đồ endpoint sinh tự động**, không phải từ kênh.

Kênh chung kiểu "gọi URL bất kỳ" là rủi ro thật nếu renderer bị XSS. Bốn lớp chặn trong `main/ipc/pve.handlers.ts`:
1. Đối chiếu `path` với registry sinh tự động — loại bỏ hoàn toàn khả năng SSRF sang host khác.
2. Kiểm tra `method` có hợp lệ cho path đó.
3. Validate `params` bằng schema Valibot sinh tự động.
4. `connectionId` phải tồn tại trong vault; renderer không bao giờ thấy credential.

**Không dùng electron-trpc** — thêm một lớp serialization trên mọi lời gọi, mà ta gọi rất dày (polling resource + polling task), và ta đã có sẵn type từ codegen nên tRPC không mang lại gì thêm.

`AbortSignal` không đi qua được IPC → thêm kênh `pve:cancel` nhận `requestId`, nối với `signal` mà TanStack Query truyền vào `queryFn`.

### 4.3 Console: relay trong main process

**So sánh hai phương án và vì sao chọn relay:**

Phương án renderer nối thẳng `wss://` sẽ vướng bốn vấn đề cùng lúc: cookie jar của Electron ghi đè header ta cố đặt; `/termproxy` **kiểm tra header `Referer`** mà renderer thì mang origin của app chứ không phải của Proxmox; TLS tự ký buộc phải qua `setCertificateVerifyProc` vốn có cache nên không được gọi mỗi request; và với nhiều cluster thì hai jar cùng dùng tên cookie `PVEAuthCookie`. Trên hết, ticket sẽ lọt vào cookie jar của renderer — đúng thứ ta đang tránh.

**Chọn relay nội bộ** trong main dùng `ws`:
1. Main mở `WebSocketServer` trên `127.0.0.1` cổng ephemeral, chỉ loopback.
2. Renderer gọi `window.pve.console.open({...})`.
3. Main gọi `/vncproxy` hoặc `/termproxy`, lấy `{ticket, port}`, cấp một **token dùng một lần, sống 30 giây**, trả về `ws://127.0.0.1:<port>/s/<token>`.
4. Main mở kết nối thượng nguồn với toàn quyền đặt `Cookie`, `Referer`, `Origin`, và dùng agent đã pin chứng chỉ.

noVNC nhận thẳng đối tượng `WebSocket` đang sống làm tham số thứ hai của `new RFB(target, ws, opts)` — nên nó không bao giờ tự dựng URL, không cần cookie, không cần Referer, không cần tin chứng chỉ. **Đây là lý do lớn nhất chọn phương án này.**

**xterm.js — không dùng `@xterm/addon-attach`.** Giao thức termproxy của Proxmox bất đối xứng: client→server đóng khung (`0:<len>:<data>` cho dữ liệu, `1:<cols>:<rows>:` cho resize, `2` cho keepalive), còn server→client là byte thô. Addon attach nối thô cả hai chiều nên sẽ hỏng chiều gửi. Tự viết `term-attach.ts` (~80 dòng). **`<len>` là số byte UTF-8, không phải độ dài chuỗi JS** — sai chỗ này thì gõ tiếng Việt sẽ vỡ ký tự. Phần bắt tay `user:ticket\n` → chờ `OK` xử lý trong main để renderer không bao giờ thấy ticket.

**SPICE**: ghi file `.vv` tạm rồi `shell.openPath` giao cho `virt-viewer` cài sẵn. Không nhúng spice-html5 trong v1.

### 4.4 Bảo mật: vault, TLS, CSP

- Credential lưu trong `better-sqlite3` tại `userData`, trường bí mật mã hoá bằng `safeStorage.encryptStringAsync` (DPAPI trên Windows). **Không dùng `keytar`** (đã archive). **Không bao giờ ghi ticket hay CSRF token xuống đĩa** — chỉ giữ trong bộ nhớ main.
- **TLS trust-on-first-use**: không dùng `rejectUnauthorized: false` đại trà. Dùng `checkServerIdentity` tuỳ biến so khớp `fingerprint256` đã ghim. Lần đầu gặp cert tự ký → hiện dialog vân tay SHA-256 dạng cặp-hai-ký-tự để người dùng đối chiếu với `pvenode cert info` trên server. Vân tay đổi về sau → chặn cứng.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`.
- CSP với `connect-src 'self' ws://127.0.0.1:*` — **cố ý không** cho phép host Proxmox, vì renderer không được nói chuyện trực tiếp với nó.
- **Không bao giờ** `dangerouslySetInnerHTML` với bất kỳ chuỗi nào đến từ Proxmox (tên VM, log task, syslog, ghi chú) — coi tất cả là thù địch.

---

## 5. Mock server — mục tiêu phát triển, không phải đồ chơi

Vì chưa có phần cứng thật, mock **chính là môi trường phát triển**. Dự trù ~4.000 dòng; nó hoàn vốn trong vòng một tháng.

Fastify 5 trên HTTPS với cert tự ký (để luyện đúng đường TOFU), nghe `https://127.0.0.1:8006` khớp cổng thật.

**Định tuyến theo schema** — dùng lại chính `pve-9.2.schema.json`:
```
với mỗi (path, method) trong schema:
  đăng ký route /api2/json{path}
    1. kiểm tra auth (cookie ticket hoặc PVEAPIToken; tôn trọng allowtoken)
    2. validate params bằng Valibot sinh tự động   ← bắt lỗi của CHÍNH client bạn
    3. gọi handler riêng nếu có
    4. nếu không, tự sinh phản hồi đúng hình dạng `returns`
    5. bọc trong { data: ... }
```

Bước 4 là chỗ ăn tiền: **cả 675 endpoint đều trả lời hợp lệ ngay ngày đầu**, nên bạn dựng được UI cho HA hay Ceph từ rất sớm. Bước 2 khiến mock **nghiêm khắc hơn Proxmox thật**, bắt được payload sai mà nếu không thì phải có phần cứng mới lộ.

Trạng thái là đồ thị object trong bộ nhớ, seed từ fixture JSON (diff được trong git): `small-standalone`, `cluster-3node`, `cluster-with-pbs`, `broken-cluster` (1 node offline, ceph degraded), `huge` (8 node / 400 guest, để test hiệu năng cây tài nguyên).

**Task engine**: UPID đúng định dạng thật, kịch bản theo mốc thời gian (`qmstart` 3 giây, `vzdump` 45 giây có dòng phần trăm, `qmclone` 20 giây). `/tasks/{upid}/log?start=&limit=` tôn trọng con trỏ — đây là thứ chứng minh logic tail log của bạn đúng. **Có tiêm lỗi** (`failRate`, `exitstatus` lỗi) vì không có task thất bại thì không xây được UI báo lỗi tử tế. Trạng thái guest đổi **khi task hoàn tất**, không phải ngay lập tức — đúng hành vi thật, buộc UI phải trung thực về optimistic update.

**Control API dev-only** tại `/__mock/`: `reset`, `scenario/:name`, `latency`, `fail`, `node/:node/offline`. Mặc định tiêm độ trễ 30–80 ms để bạn không xây một UI chỉ mượt ở 0 ms.

---

## 6. Lộ trình theo giai đoạn

Ước lượng cho **một lập trình viên có kinh nghiệm, toàn thời gian**.

| GĐ | Nội dung | Thời lượng |
|---|---|---|
| **0** | Bộ khung: workspaces, electron-vite + Vite 7 + React 19, cửa sổ Electron với CSP/sandbox, antd 6 theme tối gọn, TanStack Router shell, i18n vi, ESLint/Vitest, electron-builder ra `.exe`. **Kèm 2 ngày spike vứt đi cho console relay** để chắc kiến trúc chạy được trước khi cam kết. | 5–7 ngày |
| **1** | `pve-schema` + generator `pve-api` (675 endpoint có kiểu); core viết tay: auth provider, errors, UPID parser, property-string codec; mock server định tuyến theo schema + auto-faker + `/access/ticket` + `/cluster/resources`. | 1.5–2 tuần |
| **2** | Vault SQLite + safeStorage; UI quản lý nhiều kết nối; dialog TOFU chứng chỉ; luồng TFA/TOTP; 5 kênh IPC + validator danh sách trắng; connection pool + máy trạng thái + tự gia hạn ticket; TanStack Query nối vào `pveRequest`. | 2 tuần |
| **3** | Cây tài nguyên (`/cluster/resources` poll trong main), dashboard datacenter/node/guest, `<RrdChart>` uPlot, **dock Task log** + `useTask` + `<TaskButton>`, cluster log, tìm kiếm toàn cục. | 2–3 tuần |
| **4** | **VM (QEMU) + LXC — giai đoạn lớn nhất.** Toàn bộ lifecycle, wizard tạo VM 8 tab, wizard tạo CT, tab Hardware (disk, CD, network, CPU, memory, PCI, USB, serial, EFI/TPM, cloud-init), Options, snapshot, clone/template/migrate/move-disk/resize. | 4–5 tuần |
| **5** | **Console.** Relay + session token; noVNC; xterm.js + term-attach tự viết; console tab **và cửa sổ tách rời**; toolbar (Ctrl-Alt-Del, clipboard, fullscreen, quality); node shell; SPICE qua `.vv`; **mock RFB server + fake shell**. | 2.5–3 tuần |
| **6** | Storage (mọi loại: dir/LVM/ZFS/NFS/CIFS/iSCSI/CephFS/RBD/PBS/BTRFS), content browser + upload/download có tiến trình, vzdump jobs + lịch, restore wizard, tích hợp PBS. | 2.5–3 tuần |
| **7** | Hạ tầng node & cluster: network (bridge/bond/VLAN/OVS + pending/apply/revert), DNS/hosts/time, disks + SMART, LVM/ZFS/directory, Ceph đầy đủ, certificates/ACME, apt + updates, syslog/journal, cluster join/create. | 3–4 tuần |
| **8** | Access (users/groups/roles/pools/ACL/API token/realms LDAP-AD-OIDC/TFA), Firewall 3 cấp + security group + alias + IPSet + kéo thả sắp xếp rule, SDN (zones/vnets/subnets/controllers/IPAM), HA, ZFS replication, notification targets, metric servers. | 3–4 tuần |
| **9** | Hardening & phát hành: auto-update, ký số Windows, crash reporting, phím tắt, i18n hoàn thiện, accessibility, tối ưu hiệu năng, tài liệu. | 2 tuần |

**Tổng thực tế: 5.5–7.5 tháng làm một mình** cho parity thật sự. **Giai đoạn 0–3 (~6 tuần) đã cho một app dùng được thật** ở mức xem toàn bộ + điều khiển cơ bản — đây là mốc hợp lý để lần đầu đối chiếu với PVE thật.

---

## 7. Ba trừu tượng quyết định thành bại

Chi phí chi phối toàn dự án là 675 endpoint × form. Ba wrapper này quyết định giai đoạn 4–8 mất **ba tháng hay chín tháng**:

- **`<PveGrid endpoint=... columns=... actions=.../>`** — mỗi trong ~90 màn hình danh sách phải gói gọn dưới **40 dòng**. Nếu vượt, dừng lại sửa trừu tượng chứ đừng viết tiếp.
- **`<PveForm>`** — map `fieldErrors` từ `PveError` thẳng vào `Form.setFields()`. Làm một lần, lợi trên 100 form.
- **`<TaskButton>`** — bắn mutation, mở modal tiến trình trực tiếp, tự invalidate query key suy ra từ UPID.

Ở giai đoạn 4 thử nghiệm thêm `<SchemaForm endpoint="PUT /nodes/{node}/qemu/{vmid}/config">` sinh form **từ chính schema** (type/enum/optional/description đều đã có sẵn). Nếu chạy được, tiết kiệm cả tháng; nếu không, quay về form tường minh.

---

## 8. Cách kiểm chứng

**Mỗi giai đoạn:**
- GĐ 0: `npm run dev` hiện shell có HMR; `npm run build:win` ra `.exe` cài được; DevTools console **không có vi phạm CSP nào**.
- GĐ 1: contract test duyệt toàn bộ schema, khẳng định mock trả lời đúng hình dạng `returns` cho mọi route. Script Node xác thực với mock rồi gọi 20 endpoint, kiểm tra suy luận kiểu đầy đủ trong editor.
- GĐ 2: ma trận thủ công — mật khẩu đúng / sai / cần TFA / ticket hết hạn (mock ép 401) / token gọi endpoint `allowtoken:0` / cert đổi vân tay. Chạy mock hai lần trên cổng 8006 và 8007 để giả lập hai cluster, khởi động lại app xác nhận credential còn nguyên.
- GĐ 3: nạp `huge.json` (8 node / 400 guest) — cây phải còn mượt. Dùng React DevTools Profiler xác nhận một nhịp poll **không** re-render cả cây (đây là đường nóng nhất của app).
- GĐ 4: Playwright `_electron` chạy E2E tạo → khởi động → snapshot → rollback → xoá.
- GĐ 5: resize cửa sổ liên tục khi terminal đang mở; giết mock giữa phiên, xác nhận báo lỗi sạch và reconnect được; **gõ tiếng Việt có dấu và emoji** để bắt lỗi đóng khung theo byte.
- GĐ 6: upload file 10 MB thật lên mock, kiểm tra thanh tiến trình và nút huỷ (stream qua main, không qua renderer).
- GĐ 7: dùng nhiều `broken-cluster.json` — Ceph degraded và node chết mới là trạng thái người dùng thực sự cần UI này.
- GĐ 8: đăng nhập bằng user hạn chế quyền trong mock, xác nhận hành động bị cấm hiện mờ kèm tooltip, chứ không phải bấm vào rồi lỗi 403.

**Đối chiếu với PVE thật:** tôi sẽ viết `docs/nested-pve-hyperv.md` hướng dẫn cài Proxmox VE 9 vào một VM Hyper-V ngay trên máy Windows này. Guest bên trong sẽ chậm, nhưng **API thì 100% thật**. Nên làm việc này chậm nhất ở giai đoạn 3, và dành một tuần "đối chiếu thực tế" sau giai đoạn 4 và sau giai đoạn 7.

---

## 9. Rủi ro cần theo dõi

1. **Console là 15% khó nhất (CAO).** Lỗi đóng khung UTF-8, thương lượng subprotocol nhị phân, `binaryType`, bắt phím và focus, clipboard, bão reconnect, và vấn đề bundle noVNC trong Vite đều nằm ở đây. Giảm thiểu: mock RFB server + fake shell **không phải tuỳ chọn**, phải làm; ghim Vite 7; spike relay ở giai đoạn 0.
2. **PVE 9.2 có thay đổi phá vỡ về VNC (CAO).** `PSA-2026-00014-1` vá lỗ hổng chiếm phiên VNC; roadmap nói client ngoài dùng `vncshell`/`vncproxy` phải thích ứng. Theo câu chữ thì chủ yếu ảnh hưởng client nối thẳng cổng TCP VNC thô — thiết kế của ta đi qua `/vncwebsocket` giống hệt web UI gốc nên nhiều khả năng không bị. **Phải đọc kỹ advisory đó trước khi bắt đầu giai đoạn 5**, và đặt code console sau một lớp adapter nhận biết phiên bản qua `/version`.
3. **Bề mặt API quá lớn (CAO, mang tính cấu trúc).** Giảm thiểu chính là ba trừu tượng ở mục 7.
4. **Schema không hoàn toàn khớp JSONSchema (TRUNG BÌNH).** Proxmox tự nói vậy, và API không đánh version. Các lỗ đã biết: property string và glob `xxx[n]`. Giảm thiểu: lối thoát `client.raw()`, model viết tay cho 15 property string, và test `schema-drift` tải lại `apidoc.js` trong CI rồi diff với JSON đã commit để **biết ngay khi Proxmox đổi**.
5. **Chưa có phần cứng thật (TRUNG BÌNH).** Mock chắc chắn sẽ khác thực tế theo những cách không đoán trước (lỗi 596 của pveproxy, độ trễ proxy giữa node, đua tranh quorum, `pvestatd` cũ dữ liệu). Giảm thiểu: PVE lồng trong Hyper-V + hai tuần đối chiếu thực tế.
6. **Ký số Windows (THẤP nhưng chặn phát hành).** Installer Electron không ký sẽ bị SmartScreen chặn. Quyết sớm: chứng chỉ EV (~$300–500/năm, có uy tín ngay) hay OV (uy tín tích luỹ dần) hay không ký kèm tài liệu cảnh báo.

**Câu hỏi để ngỏ, giải quyết trước giai đoạn 5:** PVE 9.2 đã thêm endpoint xác minh VNC ticket do token sở hữu, dành cho termproxy — nếu điều này cho phép API Token mở được terminal thì UX "một kết nối cần cả token lẫn mật khẩu" có thể đơn giản hoá đáng kể.

---

## 10. Bắt đầu ngay giai đoạn 0

Khi bạn duyệt, tôi sẽ làm theo thứ tự:
1. Dựng npm workspaces + `tsconfig.base.json` + ESLint/Prettier/Vitest.
2. `apps/desktop` với electron-vite, cửa sổ Electron cấu hình bảo mật đầy đủ, antd 6 theme tối gọn, TanStack Router shell (sidebar / header / content / dock dưới), i18n tiếng Việt.
3. Spike console relay 2 ngày: main mở `WebSocketServer` loopback, nối tới một echo server tự dựng, renderer gắn xterm.js vào — chứng minh kiến trúc trước khi xây tiếp.
4. `electron-builder.yml` ra NSIS `.exe`, xác nhận cài và chạy được trên chính máy này.
