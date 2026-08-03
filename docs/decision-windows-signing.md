# Quyết định: ký số Windows

Trạng thái GĐ 9 — **chưa mua chứng chỉ**. Installer NSIS hiện **không ký**; SmartScreen
sẽ cảnh báo khi cài lần đầu.

## Lựa chọn

| Loại | Ưu | Nhược | Gợi ý |
|---|---|---|---|
| **EV** (~$300–500/năm) | Uy tín ngay, ít SmartScreen | Đắt, cần USB token / HSM | Nên chọn khi phát hành công khai |
| **OV** | Rẻ hơn | Uy tín tích luỹ dần | OK cho nội bộ / early adopters |
| **Không ký** | $0 | SmartScreen chặn; tài liệu cảnh báo | Chỉ lab / nội bộ |

**Quyết định tạm thời:** giữ unsigned + cảnh báo trong README cho đến khi có EV/OV.
Khi có cert, đặt biến môi trường CI (không commit secret):

```bash
export CSC_LINK=/path/to/cert.pfx   # hoặc base64
export CSC_KEY_PASSWORD=...
npm run build:win
```

`electron-builder` tự ký khi thấy `CSC_*`. Xem
[electron-builder code signing](https://www.electron.build/code-signing).

## Icon

`apps/desktop/resources/icon.png` (1024×1024) đã có trên main. Khi đóng gói Windows,
tuỳ chọn thêm `icon.ico` (electron-builder có thể derive từ png). Builder đọc từ
`buildResources: resources`.
