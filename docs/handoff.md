# Bàn giao — giai đoạn 7 (đang làm)

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải** — tức là
phần kiến thức không đọc ra được từ mã nguồn.

Kế hoạch tổng thể đầy đủ nằm ở [plan.md](plan.md). Hướng dẫn chạy nằm ở [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–6 đã merge vào `main`.** Giai đoạn 7 (hạ tầng node & cluster) **MVP đã mở**:
NodeDrawer + network pending/apply/revert + DNS/hosts/time.

| Hạng mục | Trạng thái |
|---|---|
| Bộ khung → Storage (GĐ 0–6) + gaps | Xong (main) |
| **Node selectable trên cây** + `selectedNode` | Xong, GĐ 7 MVP |
| **`NodeDrawer`** overview / network / DNS / hosts / time | Xong, GĐ 7 MVP |
| **Mock** network stateful + apply UPID + revert | Xong, GĐ 7 MVP |
| Disks + SMART, LVM/ZFS/dir create | Chưa |
| Apt / updates, certificates/ACME | Chưa |
| Ceph đầy đủ + fixture `broken-cluster` | Chưa |
| Syslog/journal, cluster join/create | Chưa |

### Kiểm chứng

```bash
npm test && npm run typecheck && npm run lint
```

```bash
npm run dev:mock
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run dev
# Click node trên cây → Network: thêm bridge → Apply / Revert
```

---

## 2–5. Quyết định & bẫy (các GĐ trước — vẫn hiệu lực)

Giữ nguyên các mục từ handoff GĐ 5–6: relay console, transfer stream qua main,
multipart mock, bẫy QEMU `memory` kiểu chuỗi, headless `PVE_E2E_MOCK_URL`.

**Network pending (GĐ 7):** mock giữ `network` (working) + `committed` (đã apply).
`POST/PUT/DELETE …/network/{iface}` sửa working và đánh dấu pending; `PUT …/network`
= apply (UPID `networkreload`); `DELETE …/network` = revert về committed. UI banner
pending là client-side sau thao tác chỉnh sửa.

---

## 6. Việc tiếp theo — phần còn lại GĐ 7

1. Disks list + SMART + init GPT / wipe
2. Tạo directory / LVM / LVMthin / ZFS pool (scan helpers GĐ 6 đã có stub)
3. Apt repositories + `POST …/apt/update` (TaskButton)
4. Certificates + ACME (node + cluster)
5. Syslog / journal viewer
6. Ceph status/OSD/pool + fixture **`broken-cluster`** (plan §8)
7. Cluster create / join UI

### Điểm nối

- `TaskButton` / `PveGrid` / `PveForm` / `NodeDrawer` tabs
- Seed mạng mặc định: `defaultNodeInfra()` trong `state/node-infra.ts` (eth0 + vmbr0)
- Handlers: `handlers/node-infra.ts`

---

## 7–8. Câu hỏi để ngỏ

1. **Ký số Windows** — EV/OV trước phát hành.
2. Icon riêng (đang dùng mặc định Electron).
