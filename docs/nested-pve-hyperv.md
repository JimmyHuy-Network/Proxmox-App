# Proxmox VE lồng trong Hyper-V (đối chiếu API thật)

Hướng dẫn dựng một node Proxmox VE 9 bên trong Hyper-V trên Windows để đối chiếu
API/UI với mock — guest chậm nhưng **API 100% thật**.

## Yêu cầu

- Windows 10/11 Pro hoặc Windows Server với Hyper-V
- ISO Proxmox VE 9.x từ https://www.proxmox.com/en/downloads
- ≥ 4 vCPU, 8 GB RAM, 64 GB disk cho VM PVE
- Nested virtualization bật nếu muốn chạy VM bên trong PVE:

```powershell
Set-VMProcessor -VMName "pve-lab" -ExposeVirtualizationExtensions $true
```

## Cài đặt nhanh

1. Tạo VM Gen2, Secure Boot **Off** (PVE dùng GRUB/systemd-boot riêng).
2. Gắn ISO, cài PVE mặc định (filesystem ZFS hoặc ext4 đều được cho lab).
3. Sau cài, truy cập `https://<IP>:8006` — chấp nhận cert tự ký.
4. Trong app desktop: **Kết nối** → host = IP VM, user `root@pam`, bật
   “cho phép cert tự ký” hoặc tin cậy fingerprint (TOFU).

## Mạng

- **External switch** Hyper-V: PVE có IP LAN, app trên host gọi trực tiếp.
- **Default switch / Internal**: cần NAT hoặc port forward tới 8006.

Firewall PVE mặc định cho phép 8006; nếu đổi zone mạng, mở lại trong
Datacenter → Firewall hoặc `pve-firewall`.

## Giới hạn đã biết

- Nested VM rất chậm — chỉ dùng để kiểm API/UI, không benchmark.
- Một số tính năng (SR-IOV, GPU passthrough, Ceph đa OSD) không khả thi trong lab nhỏ.
- Ticket/TFA/ACL/console hoạt động như cluster thật một node.

## Checklist đối chiếu

Sau GĐ 3/4/7/8 nên đối chiếu ít nhất:

- [ ] Đăng nhập ticket + TFA
- [ ] Cây `/cluster/resources` + RRD
- [ ] Start/stop VM + snapshot
- [ ] Console VNC/xterm
- [ ] Storage content / upload nhỏ
- [ ] Node network pending/apply
- [ ] Access ACL + user hạn chế (UI disabled)

Mock vẫn là môi trường CI chính; Hyper-V PVE là “chân lý” khi nghi ngờ hành vi API.
