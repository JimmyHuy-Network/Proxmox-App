import type { Terminal } from '@xterm/xterm'
import { TERM_PING, encodeTermData, encodeTermResize } from '@shared/term-protocol'

/**
 * Nối xterm.js với relay console.
 *
 * KHÔNG dùng `@xterm/addon-attach` cho việc này. Addon đó nối thô cả hai chiều,
 * trong khi giao thức termproxy của Proxmox bất đối xứng: chiều gửi phải đóng khung,
 * chiều nhận là byte thô. Dùng addon thì mọi phím gõ đều tới server sai định dạng.
 *
 * Xem `@shared/term-protocol` để biết chi tiết khung và cạm bẫy độ dài byte.
 */

/** Server ngắt phiên sau 5 phút im lặng, nên giữ nhịp thoải mái dưới ngưỡng đó. */
const PING_INTERVAL_MS = 30_000

export interface TermAttachHandle {
  dispose(): void
}

export function attachTerminal(term: Terminal, socket: WebSocket): TermAttachHandle {
  socket.binaryType = 'arraybuffer'

  const send = (payload: string): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload)
  }

  // Chiều gửi: đóng khung theo giao thức.
  const dataSub = term.onData((data) => send(encodeTermData(data)))
  const resizeSub = term.onResize(({ cols, rows }) => send(encodeTermResize(cols, rows)))

  // Chiều nhận: byte thô, ghi thẳng vào terminal.
  // Đưa Uint8Array chứ không đưa chuỗi: để xterm tự ghép các chuỗi UTF-8 bị cắt
  // ngang giữa hai gói tin. Tự giải mã ở đây sẽ làm vỡ ký tự tiếng Việt nằm
  // vắt qua ranh giới gói.
  const onMessage = (event: MessageEvent<ArrayBuffer | string>): void => {
    if (typeof event.data === 'string') term.write(event.data)
    else term.write(new Uint8Array(event.data))
  }
  socket.addEventListener('message', onMessage)

  const ping = window.setInterval(() => send(TERM_PING), PING_INTERVAL_MS)

  // Báo kích thước ban đầu — server không biết terminal rộng bao nhiêu cho tới khi được nói.
  // Sau resize, gửi một Enter để đánh thức agetty/login (LXC/serial thường clear
  // màn hình rồi đứng im cho tới khi có phím — đúng triệu chứng console đen + cursor).
  const sendInitialSize = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    if (term.cols > 0 && term.rows > 0) send(encodeTermResize(term.cols, term.rows))
  }
  const wakeConsole = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    send(encodeTermData('\r'))
  }
  const scheduleInitialSize = (): void => {
    sendInitialSize()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sendInitialSize()
        wakeConsole()
      })
    })
  }
  if (socket.readyState === WebSocket.OPEN) scheduleInitialSize()
  else socket.addEventListener('open', scheduleInitialSize, { once: true })

  return {
    dispose() {
      window.clearInterval(ping)
      socket.removeEventListener('message', onMessage)
      dataSub.dispose()
      resizeSub.dispose()
    },
  }
}
