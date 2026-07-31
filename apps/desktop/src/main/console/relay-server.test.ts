import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { encodeTermData, encodeTermResize } from '@shared/term-protocol'
import { ConsoleRelayServer } from './relay-server'
import { createFakeShellSession } from './demo-session'

/**
 * Test tích hợp đầu-cuối cho đường đi console: relay server → fake shell →
 * đóng khung termproxy → quay ngược về client.
 *
 * Đây là phần rủi ro cao nhất của toàn dự án (xem mục 9 trong kế hoạch), nên nó
 * được kiểm bằng WebSocket thật trên loopback chứ không phải bằng mock.
 */

let relay: ConsoleRelayServer

beforeEach(async () => {
  relay = new ConsoleRelayServer()
  await relay.start()
})

afterEach(() => {
  relay.stop()
})

function newSessionUrl(): string {
  return relay.createSession(createFakeShellSession('test')).relayUrl
}

interface OpenSocket {
  socket: WebSocket
  waitFor(needle: string, timeoutMs?: number): Promise<void>
  clear(): void
  readonly text: string
  ready: Promise<void>
}

/**
 * Mở socket VÀ gắn listener `message` ngay trong cùng một lượt đồng bộ.
 *
 * Không được tách thành `await connect()` rồi mới gắn listener: server gửi MOTD
 * ngay khi phiên được nối, và khi phản hồi 101 cùng khung dữ liệu về chung một gói
 * TCP thì `ws` phát `open` rồi phát luôn `message` trước khi nhả về event loop.
 * Listener gắn ở microtask sau đó sẽ vĩnh viễn bỏ lỡ những khung đầu tiên.
 */
function openSocket(url: string): OpenSocket {
  const socket = new WebSocket(url, 'binary')
  let text = ''

  socket.on('message', (data: Buffer) => {
    text += data.toString('utf8')
  })

  const ready = new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err)
    const onClose = (code: number): void => reject(new Error(`đóng sớm với mã ${code}`))
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.once('open', () => {
      socket.off('error', onError)
      socket.off('close', onClose)
      resolve()
    })
  })

  return {
    socket,
    ready,
    get text() {
      return text
    },
    clear() {
      text = ''
    },
    async waitFor(needle: string, timeoutMs = 4000): Promise<void> {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (text.includes(needle)) return
        await new Promise((r) => setTimeout(r, 15))
      }
      throw new Error(
        `Hết thời gian chờ "${needle}". Đã nhận được: ${JSON.stringify(text.slice(-400))}`,
      )
    },
  }
}

/** Mở phiên và chờ tới khi dấu nhắc xuất hiện, sẵn sàng để gõ lệnh. */
async function openAtPrompt(): Promise<OpenSocket> {
  const session = openSocket(newSessionUrl())
  await session.ready
  await session.waitFor('# ')
  session.clear()
  return session
}

/** Kỳ vọng bị từ chối ngay ở bước HTTP upgrade, trả về thông điệp lỗi. */
function expectRejected(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, 'binary')
    socket.once('error', (err: Error) => resolve(err.message))
    socket.once('open', () => {
      socket.close()
      reject(new Error('lẽ ra phải bị từ chối ở bước upgrade nhưng lại mở được'))
    })
  })
}

describe('ConsoleRelayServer', () => {
  it('chỉ lắng nghe trên loopback', () => {
    expect(newSessionUrl()).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]{64}$/)
  })

  it('bơm được dữ liệu hai chiều tới shell', async () => {
    const session = openSocket(newSessionUrl())
    await session.ready
    await session.waitFor('Proxmox VE 9.2.1')
    session.socket.close()
  })

  it('echo lại tiếng Việt có dấu nguyên vẹn', async () => {
    // Đây là bài test then chốt. Nếu đóng khung dùng String.length thay vì số byte
    // UTF-8, server sẽ đọc thiếu byte và chuỗi echo về sẽ bị cụt hoặc vỡ ký tự.
    const session = await openAtPrompt()

    const typed = 'Xin chào các bạn'
    session.socket.send(encodeTermData(typed))

    await session.waitFor(typed)
    session.socket.close()
  })

  it('không mất byte với chuỗi toàn ký tự nhiều byte', async () => {
    // "àààà" có String.length 4 nhưng chiếm 8 byte. Khai báo nhầm 4 thì server
    // chỉ đọc được 2 ký tự — bài test này bắt đúng lỗi đó.
    const session = await openAtPrompt()
    session.socket.send(encodeTermData('àààà'))

    await session.waitFor('àààà')
    session.socket.close()
  })

  it('giữ nguyên emoji nằm ngoài mặt phẳng cơ bản', async () => {
    const session = await openAtPrompt()
    session.socket.send(encodeTermData('🚀'))

    await session.waitFor('🚀')
    session.socket.close()
  })

  it('chạy lệnh và trả kết quả', async () => {
    const session = await openAtPrompt()
    session.socket.send(encodeTermData('pveversion\r'))

    await session.waitFor('pve-manager/9.2.1')
    session.socket.close()
  })

  it('nhận và áp dụng khung đổi kích thước', async () => {
    const session = await openAtPrompt()

    session.socket.send(encodeTermResize(120, 40))
    session.socket.send(encodeTermData('size\r'))

    await session.waitFor('120 cột × 40 dòng')
    session.socket.close()
  })

  it('token chỉ dùng được đúng một lần', async () => {
    const url = newSessionUrl()
    const first = openSocket(url)
    await first.ready

    // Dùng lại đúng URL đó phải bị từ chối, kể cả khi phiên đầu còn đang mở.
    await expect(expectRejected(url)).resolves.toContain('401')
    first.socket.close()
  })

  it('từ chối token không tồn tại trước khi bắt tay xong', async () => {
    const bogus = newSessionUrl().replace(/\/s\/[0-9a-f]{64}$/, `/s/${'a'.repeat(64)}`)
    await expect(expectRejected(bogus)).resolves.toContain('401')
  })

  it('từ chối URL sai định dạng', async () => {
    const badPath = newSessionUrl().replace(/\/s\/[0-9a-f]{64}$/, '/khong-hop-le')
    await expect(expectRejected(badPath)).resolves.toContain('400')
  })
})
