/**
 * Máy chủ RFB (VNC) tối giản cho mock `/vncwebsocket`.
 *
 * Đủ để noVNC bắt tay, hiện một framebuffer màu đặc, và nhận phím/chuột
 * (Ctrl-Alt-Del được ghi nhận bằng cờ). Không phải VNC đầy đủ — chỉ luyện đường
 * đi client ↔ relay ↔ mock.
 *
 * Giao thức: RFB 3.8, security type None (1), encoding Raw (0).
 */

const RFB_VERSION = Buffer.from('RFB 003.008\n')

export interface FakeRfbOptions {
  width?: number
  height?: number
  name?: string
  /** Màu nền RGB (mặc định xanh Proxmox-ish). */
  color?: { r: number; g: number; b: number }
}

type Phase = 'version' | 'security' | 'init' | 'ready' | 'closed'

export class FakeRfb {
  private phase: Phase = 'version'
  private buf = Buffer.alloc(0)
  private width: number
  private height: number
  private name: string
  private color: { r: number; g: number; b: number }
  private ctrl = false
  private alt = false
  private cadPressed = false

  private readonly send: (data: Buffer) => void
  private readonly onClose: () => void

  constructor(
    send: (data: Buffer) => void,
    onClose: () => void,
    options: FakeRfbOptions = {},
  ) {
    this.send = send
    this.onClose = onClose
    this.width = options.width ?? 800
    this.height = options.height ?? 600
    this.name = options.name ?? 'Mock VNC'
    this.color = options.color ?? { r: 0x1a, g: 0x3a, b: 0x5c }
  }

  start(): void {
    this.send(RFB_VERSION)
  }

  handleRaw(data: Buffer): void {
    if (this.phase === 'closed') return
    this.buf = Buffer.concat([this.buf, data])
    this.pump()
  }

  get receivedCtrlAltDel(): boolean {
    return this.cadPressed
  }

  close(): void {
    this.phase = 'closed'
  }

  private pump(): void {
    // Loop vì một gói có thể chứa nhiều thông điệp.
    for (;;) {
      if (this.phase === 'version') {
        if (this.buf.length < 12) return
        // Client gửi `RFB 003.00x\n` — chấp nhận mọi 3.x.
        this.buf = this.buf.subarray(12)
        // Security types: 1 loại, None = 1
        this.send(Buffer.from([1, 1]))
        this.phase = 'security'
        continue
      }

      if (this.phase === 'security') {
        if (this.buf.length < 1) return
        const chosen = this.buf[0]
        this.buf = this.buf.subarray(1)
        if (chosen !== 1) {
          // SecurityResult failed
          const fail = Buffer.alloc(4)
          fail.writeUInt32BE(1, 0)
          this.send(fail)
          this.phase = 'closed'
          this.onClose()
          return
        }
        // SecurityResult OK
        this.send(Buffer.alloc(4)) // 0 = OK
        this.phase = 'init'
        continue
      }

      if (this.phase === 'init') {
        // ClientInit: 1 byte shared-flag
        if (this.buf.length < 1) return
        this.buf = this.buf.subarray(1)
        this.sendServerInit()
        this.phase = 'ready'
        // Gửi ngay một framebuffer đầy đủ.
        this.sendFramebufferUpdate(0, 0, this.width, this.height)
        continue
      }

      if (this.phase === 'ready') {
        if (this.buf.length < 1) return
        const msgType = this.buf[0]!
        if (!this.consumeClientMessage(msgType)) return
        continue
      }

      return
    }
  }

  private consumeClientMessage(msgType: number): boolean {
    switch (msgType) {
      case 0: {
        // SetPixelFormat — 20 bytes total
        if (this.buf.length < 20) return false
        this.buf = this.buf.subarray(20)
        return true
      }
      case 2: {
        // SetEncodings
        if (this.buf.length < 4) return false
        const count = this.buf.readUInt16BE(2)
        const need = 4 + count * 4
        if (this.buf.length < need) return false
        this.buf = this.buf.subarray(need)
        return true
      }
      case 3: {
        // FramebufferUpdateRequest — 10 bytes
        if (this.buf.length < 10) return false
        const incremental = this.buf[1] === 1
        const x = this.buf.readUInt16BE(2)
        const y = this.buf.readUInt16BE(4)
        const w = this.buf.readUInt16BE(6)
        const h = this.buf.readUInt16BE(8)
        this.buf = this.buf.subarray(10)
        if (!incremental) this.sendFramebufferUpdate(x, y, w, h)
        return true
      }
      case 4: {
        // KeyEvent — 8 bytes
        if (this.buf.length < 8) return false
        const down = this.buf[1] === 1
        const key = this.buf.readUInt32BE(4)
        this.buf = this.buf.subarray(8)
        this.trackCad(key, down)
        return true
      }
      case 5: {
        // PointerEvent — 6 bytes
        if (this.buf.length < 6) return false
        this.buf = this.buf.subarray(6)
        return true
      }
      case 6: {
        // ClientCutText
        if (this.buf.length < 8) return false
        const len = this.buf.readUInt32BE(4)
        const need = 8 + len
        if (this.buf.length < need) return false
        this.buf = this.buf.subarray(need)
        return true
      }
      default: {
        // Không rõ — đóng để tránh lệch luồng.
        this.phase = 'closed'
        this.onClose()
        return false
      }
    }
  }

  private trackCad(keysym: number, down: boolean): void {
    // XK_Control_L/R, XK_Alt_L/R, XK_Delete
    if (keysym === 0xffe3 || keysym === 0xffe4) this.ctrl = down
    if (keysym === 0xffe9 || keysym === 0xffea) this.alt = down
    if (keysym === 0xffff && down && this.ctrl && this.alt) {
      this.cadPressed = true
      // Nhấp nháy framebuffer sang đỏ nhẹ để UI thấy phản hồi.
      this.color = { r: 0x80, g: 0x20, b: 0x20 }
      this.sendFramebufferUpdate(0, 0, this.width, this.height)
    }
  }

  private sendServerInit(): void {
    const nameBuf = Buffer.from(this.name, 'utf8')
    const buf = Buffer.alloc(24 + nameBuf.length)
    buf.writeUInt16BE(this.width, 0)
    buf.writeUInt16BE(this.height, 2)
    // Pixel format: 32 bpp, 24 depth, little-endian, true colour, 255 max, RGB shifts
    buf[4] = 32 // bits-per-pixel
    buf[5] = 24 // depth
    buf[6] = 0 // big-endian-flag
    buf[7] = 1 // true-colour-flag
    buf.writeUInt16BE(255, 8) // red-max
    buf.writeUInt16BE(255, 10)
    buf.writeUInt16BE(255, 12)
    buf[14] = 0 // red-shift
    buf[15] = 8 // green-shift
    buf[16] = 16 // blue-shift
    // 3 padding
    buf.writeUInt32BE(nameBuf.length, 20)
    nameBuf.copy(buf, 24)
    this.send(buf)
  }

  private sendFramebufferUpdate(x: number, y: number, w: number, h: number): void {
    const width = Math.min(w, this.width - x)
    const height = Math.min(h, this.height - y)
    if (width <= 0 || height <= 0) return

    const pixels = Buffer.alloc(width * height * 4)
    for (let i = 0; i < width * height; i += 1) {
      const o = i * 4
      pixels[o] = this.color.r
      pixels[o + 1] = this.color.g
      pixels[o + 2] = this.color.b
      pixels[o + 3] = 0xff
    }

    // Vẽ một dải sáng ở giữa để nhìn rõ "có hình".
    const midY = Math.floor(height / 2)
    for (let row = midY - 2; row <= midY + 2; row += 1) {
      if (row < 0 || row >= height) continue
      for (let col = 0; col < width; col += 1) {
        const o = (row * width + col) * 4
        pixels[o] = 0xe5
        pixels[o + 1] = 0x70
        pixels[o + 2] = 0x00
      }
    }

    const header = Buffer.alloc(4 + 12)
    header[0] = 0 // FramebufferUpdate
    header[1] = 0 // padding
    header.writeUInt16BE(1, 2) // number-of-rectangles
    header.writeUInt16BE(x, 4)
    header.writeUInt16BE(y, 6)
    header.writeUInt16BE(width, 8)
    header.writeUInt16BE(height, 10)
    header.writeInt32BE(0, 12) // encoding raw

    this.send(Buffer.concat([header, pixels]))
  }
}
