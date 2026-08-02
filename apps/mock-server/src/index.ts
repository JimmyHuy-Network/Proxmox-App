import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { ensureTls } from './tls.ts'
import { MockContext, FIXTURES, type FixtureName } from './context.ts'
import { registerSchemaRoutes } from './router.ts'
import { buildHandlers } from './handlers/index.ts'
import { registerControlApi } from './control.ts'
import { attachConsoleWebSocket } from './console/websocket.ts'

/**
 * Máy chủ Proxmox VE giả lập.
 *
 *   node src/index.ts [--port 8006] [--fixture cluster-3node] [--quiet]
 *
 * Không phải đồ chơi kiểm thử — đây là **môi trường phát triển chính** cho tới khi
 * có phần cứng thật. Nó nghiêm khắc hơn Proxmox thật ở khâu kiểm tham số, và nó
 * giả lập được cả những trạng thái hỏng hóc mà một cụm máy thật không dễ tạo ra.
 */

export interface StartOptions {
  port?: number
  host?: string
  fixture?: FixtureName
  quiet?: boolean
}

export async function startMockServer(options: StartOptions = {}) {
  const { port = 8006, host = '127.0.0.1', fixture = 'cluster-3node', quiet = false } = options

  const mock = new MockContext(fixture)
  const { key, cert } = ensureTls()

  const app = Fastify({
    https: { key, cert },
    logger: quiet ? false : { level: 'warn' },
    // Proxmox nhận tham số qua form urlencoded, không nhận JSON body.
    bodyLimit: 64 * 1024 * 1024,
  })

  // Proxmox nhận tham số dưới dạng x-www-form-urlencoded, KHÔNG nhận JSON body.
  // Fastify không có sẵn bộ phân tích cho kiểu này, và thiếu nó thì mọi POST đều
  // trả 415 — một lỗi rất dễ mất thời gian truy vì thông báo không nói gì về nguyên nhân.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)))
      } catch (error) {
        done(error as Error, undefined)
      }
    },
  )

  // Upload ISO/vztmpl của Proxmox dùng multipart/form-data. Chuyển thành object
  // phẳng trước khi schema-router kiểm tham số (content, filename bắt buộc).
  await app.register(multipart, {
    limits: { fileSize: 64 * 1024 * 1024, files: 1 },
  })

  app.addHook('preValidation', async (request) => {
    if (!request.isMultipart()) return

    const body: Record<string, unknown> = {}
    let uploadSize = 0
    let uploadFilename: string | undefined

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploadFilename = part.filename || uploadFilename
        if (!body['filename'] && part.filename) body['filename'] = part.filename
        for await (const chunk of part.file) {
          uploadSize += chunk.length
        }
      } else {
        body[part.fieldname] = part.value
      }
    }

    body['__uploadSize'] = uploadSize
    if (uploadFilename) body['__uploadFilename'] = uploadFilename
    request.body = body
  })

  // Proxmox không gửi CORS header, và ứng dụng desktop không cần chúng vì mọi
  // request đi từ tiến trình main. Giữ đúng như vậy để mock không dễ dãi hơn thật.

  const handlers = buildHandlers(mock.auth)
  const routeCount = registerSchemaRoutes(app, mock, handlers, mock.auth)
  registerControlApi(app, mock)

  await app.listen({ port, host })

  // WebSocket console gắn SAU listen — `app.server` lúc này đã là HTTPS server thật.
  const consoleWss = attachConsoleWebSocket(app.server, mock.auth, mock.consoleTickets)

  // Đọc cổng THẬT chứ không dùng lại tham số: truyền 0 nghĩa là nhờ hệ điều hành
  // cấp một cổng trống, và lúc đó `port` vẫn đang là 0.
  const address = app.server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port
  const url = `https://${host}:${actualPort}`
  if (!quiet) {
    console.log('')
    console.log(`  Proxmox VE giả lập đang chạy tại ${url}`)
    console.log(`  Đã đăng ký ${routeCount} endpoint từ schema PVE 9.2`)
    console.log(`  Kịch bản: ${fixture}`)
    console.log('')
    console.log('  Đăng nhập: bất kỳ tên nào, mật khẩu bất kỳ TRỪ chuỗi "sai"')
    console.log('  Tài khoản tfa@pve luôn yêu cầu OTP (mã giả lập: 123456)')
    console.log('  API Token: root@pam!automation=00000000-1111-2222-3333-444444444444')
    console.log('')
    console.log(`  Điều khiển: POST ${url}/__mock/reset | /__mock/latency | /__mock/fail`)
    console.log('')
  }

  return {
    url,
    port: actualPort,
    mock,
    routeCount,
    async close(): Promise<void> {
      for (const client of consoleWss.clients) client.terminate()
      consoleWss.close()
      mock.stop()
      await app.close()
    },
  }
}

function parseArgs(argv: string[]): StartOptions {
  const options: StartOptions = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') options.port = Number(argv[++i])
    else if (arg === '--host') options.host = argv[++i] as string
    else if (arg === '--quiet') options.quiet = true
    else if (arg === '--fixture') {
      const name = argv[++i] as FixtureName
      if (!FIXTURES.includes(name)) {
        throw new Error(`Kịch bản không tồn tại: ${name}. Có sẵn: ${FIXTURES.join(', ')}`)
      }
      options.fixture = name
    }
  }

  return options
}

/** Chỉ tự chạy khi được gọi trực tiếp; khi bị import trong test thì không. */
function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isMainModule()) {
  const server = await startMockServer(parseArgs(process.argv.slice(2)))
  const shutdown = (): void => {
    void server.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
