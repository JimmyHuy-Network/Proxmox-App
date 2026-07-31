import type { WebSocket } from 'ws'
import { decodeTermFrame } from '@shared/term-protocol'
import { FakeShell } from './fake-shell'
import type { RelaySession } from './relay-server'

/**
 * Phiên console nối tới shell giả lập trong tiến trình.
 *
 * Tách riêng khỏi tầng IPC để bộ test tích hợp chạy đúng đoạn mã mà sản phẩm chạy,
 * chứ không phải một bản chép lại sẽ trôi dạt theo thời gian.
 */
export function createFakeShellSession(title: string): RelaySession {
  return {
    kind: 'term',
    title,
    attach(client: WebSocket) {
      const shell = new FakeShell((data) => {
        if (client.readyState === client.OPEN) client.send(Buffer.from(data, 'utf8'))
      })

      client.on('message', (data: Buffer) => {
        // Buffer là lớp con của Uint8Array nên đưa thẳng vào bộ giải mã được.
        // Bắt buộc giải mã theo byte: cắt theo ký tự sẽ làm hỏng chuỗi nhiều byte.
        const frame = decodeTermFrame(data)
        if (frame) shell.handleFrame(frame)
      })

      client.on('close', () => shell.close())
      client.on('error', () => shell.close())

      shell.start()
    },
  }
}
