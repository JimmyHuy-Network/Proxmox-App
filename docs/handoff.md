# Bàn giao — hết giai đoạn 7

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải**.

Kế hoạch: [plan.md](plan.md) · Chạy thử: [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–7 hoàn tất** (GĐ 7 trên nhánh này / PR). Việc tiếp theo: **giai đoạn 8 — Access /
Firewall / SDN / HA**.

| Hạng mục | Trạng thái |
|---|---|
| GĐ 0–6 + gaps (console, storage, search, huge…) | Xong (main) |
| **NodeDrawer** (overview/network/DNS/hosts/time) | Xong, GĐ 7 |
| **Disks** (list, SMART, initgpt, wipe, dir/LVM/ZFS) | Xong, GĐ 7 |
| **Apt** updates/versions + TaskButton refresh | Xong, GĐ 7 |
| **Certificates** info + ACME order/renew | Xong, GĐ 7 |
| **Syslog / journal** | Xong, GĐ 7 |
| **Ceph** status/MON/pool + fixture `broken-cluster` | Xong, GĐ 7 |
| **Cluster** create/join page + corosync nodes | Xong, GĐ 7 |

### Kiểm chứng

```bash
npm test && npm run typecheck && npm run lint
```

```bash
npm run dev:mock
# hoặc: npm run dev --workspace=@pve/mock-server -- --fixture broken-cluster
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run dev
```

Click node → tabs Disks / Updates / Certificates / Logs / Ceph. Menu **Cluster** để create/join.

---

## 2. Quyết định GĐ 7

**State hạ tầng trong `MockContext`**, không nhét JSON fixture: `ensureNodeInfra(node)` seed
eth0/vmbr0 + disks/apt/certs; Ceph/cluster config là object dùng chung cụm.

**Network pending:** working copy + `committed`; Apply = UPID `networkreload`; Revert =
`DELETE /nodes/{node}/network`.

**`broken-cluster`:** pve3 offline, `quorate: false`, Ceph `HEALTH_WARN` (1 OSD down).

---

## 3. Việc tiếp theo — giai đoạn 8

Access (users/groups/roles/ACL/token/realms/TFA), Firewall 3 cấp + security group/IPSet,
SDN, HA, ZFS replication, notification targets, metric servers.

### Điểm nối còn hiệu lực

- `TaskButton` / `PveGrid` / `PveForm` / drawer tabs
- Handlers: `node-infra.ts`, `node-system.ts`, `ceph-cluster.ts`
- Upload lớn chỉ qua `pve:transfer`
- Headless: `PVE_E2E_MOCK_URL` + E2E encryptor

---

## 4. Câu hỏi để ngỏ

1. Ký số Windows (EV/OV).
2. Icon riêng.
