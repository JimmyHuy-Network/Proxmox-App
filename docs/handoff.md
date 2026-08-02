# Bàn giao — hết giai đoạn 8

Tài liệu này dành cho người (hoặc phiên làm việc) tiếp nhận dự án. Nó ghi lại **trạng thái
hiện tại**, **những quyết định đã chốt và lý do**, và **những cái bẫy đã vấp phải**.

Kế hoạch: [plan.md](plan.md) · Chạy thử: [../README.md](../README.md).

---

## 1. Đang ở đâu

**Giai đoạn 0–8 hoàn tất** (GĐ 8 trên nhánh này / PR). Việc tiếp theo: **giai đoạn 9 —
Hardening & phát hành**.

| Hạng mục | Trạng thái |
|---|---|
| GĐ 0–7 | Xong (main) |
| **Access** (users/groups/roles/ACL/pools/realms LDAP-AD-OIDC/token/TFA) | Xong, GĐ 8 |
| **Permissions / cap UI** (disabled + tooltip, không 403 sau click) | Xong, GĐ 8 |
| **Firewall 3 cấp** + alias/IPSet/security group + reorder (moveto) | Xong, GĐ 8 |
| **SDN** zones/vnets/subnets/controllers/IPAM + apply | Xong, GĐ 8 |
| **HA** groups/resources/status | Xong, GĐ 8 |
| **ZFS replication** | Xong, GĐ 8 |
| **Notification targets / matchers** | Xong, GĐ 8 |
| **Metric servers** | Xong, GĐ 8 |

### Kiểm chứng

```bash
npm test && npm run typecheck && npm run lint
```

```bash
npm run dev:mock
DISPLAY=:1 PVE_E2E_MOCK_URL=https://127.0.0.1:8006 npm run dev
# User hạn chế: PVE_E2E_USER=vanhanh@pve PVE_E2E_PASSWORD=x
```

Menu **Access / Firewall / SDN·HA·…**. Guest power của `vanhanh@pve` phải **mờ + tooltip**.

---

## 2. Quyết định GĐ 8

**State** trong `MockContext.phase8` (`state/phase8.ts`), seed kèm ACL: `operators` →
`PVEAuditor` trên `/` — `vanhanh@pve` chỉ có `*.Audit`, không `VM.PowerMgmt`.

**Cap / permissions:** `GET /access/permissions` + hook `usePermissions` + `TaskButton.allowed`
/ `CapButton`. Tiêu chí plan: hành động bị cấm hiện mờ kèm tooltip.

**Firewall reorder:** `PUT …/rules/{pos}` với `moveto` (nút ↑↓), không cần DnD thư viện.

**Handlers:** `access.ts`, `firewall.ts`, `sdn-ha.ts` — cùng pattern `apply*Handlers` như GĐ 7.

---

## 3. Việc tiếp theo — giai đoạn 9

Hardening & phát hành: auto-update, ký số Windows, crash reporting, phím tắt, i18n hoàn thiện,
accessibility, tối ưu hiệu năng, tài liệu (`docs/nested-pve-hyperv.md`).

### Điểm nối còn hiệu lực

- `TaskButton` (`allowed` / `denyReason`) / `CapButton` / `usePermissions`
- `PveGrid` / `PveForm` / drawer tabs
- Handlers GĐ 8 + `node-infra` / `node-system` / `ceph-cluster`
- Headless: `PVE_E2E_MOCK_URL` + E2E encryptor; thử `PVE_E2E_USER=vanhanh@pve`

---

## 4. Câu hỏi để ngỏ

1. Ký số Windows (EV/OV).
2. Icon riêng.
3. Deep-link / phím tắt cho từng tab Access·Firewall.
