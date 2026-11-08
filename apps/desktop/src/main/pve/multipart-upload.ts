import { createReadStream, statSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createTlsAgent } from './tls-agent.ts'

/**
 * POST multipart lên `/nodes/{node}/storage/{storage}/upload`.
 *
 * Không đi qua `PveClient` vì transport hiện chỉ gửi x-www-form-urlencoded.
 * Stream từ đĩa → request để file lớn không nằm hết trong RAM renderer/main.
 */

export interface MultipartUploadInit {
  host: string
  port: number
  node: string
  storage: string
  content: string
  filename: string
  filePath: string
  headers: Record<string, string>
  pinnedFingerprint?: string
  allowSelfSigned?: boolean
  signal?: AbortSignal
  onProgress?: (bytesSent: number, totalBytes: number) => void
}

export interface MultipartUploadResult {
  status: number
  /** UPID hoặc chuỗi data từ Proxmox. */
  data: string | null
  message?: string
}

function encodeMultipart(
  boundary: string,
  fields: Record<string, string>,
  fileField: { name: string; filename: string },
): { preamble: Buffer; epilogue: Buffer } {
  const parts: string[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${value}\r\n`,
    )
  }
  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  )
  const preamble = Buffer.from(parts.join(''))
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { preamble, epilogue }
}

async function readJsonBody(res: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of res) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function uploadMultipart(init: MultipartUploadInit): Promise<MultipartUploadResult> {
  const totalBytes = statSync(init.filePath).size
  const boundary = '----PveUpload' + randomBytes(12).toString('hex')
  const { preamble, epilogue } = encodeMultipart(
    boundary,
    { content: init.content, filename: init.filename },
    { name: 'filename', filename: init.filename },
  )
  const contentLength = preamble.length + totalBytes + epilogue.length

  const agent = createTlsAgent(init, { keepAlive: false })

  return new Promise((resolve, reject) => {
    if (init.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const path = `/api2/json/nodes/${encodeURIComponent(init.node)}/storage/${encodeURIComponent(init.storage)}/upload`
    const req = httpsRequest(
      {
        host: init.host,
        port: init.port,
        method: 'POST',
        path,
        agent,
        headers: {
          Accept: 'application/json',
          ...init.headers,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(contentLength),
        },
      },
      (res) => {
        void readJsonBody(res).then((body) => {
          const obj = body as { data?: unknown; message?: string } | null
          const data =
            obj && typeof obj === 'object' && obj.data !== undefined && obj.data !== null
              ? String(obj.data)
              : null
          resolve({
            status: res.statusCode ?? 0,
            data,
            ...(obj && typeof obj === 'object' && obj.message ? { message: obj.message } : {}),
          })
        }, reject)
      },
    )

    req.on('error', (err) => reject(err))

    const onAbort = (): void => {
      req.destroy(new DOMException('Aborted', 'AbortError'))
    }
    init.signal?.addEventListener('abort', onAbort, { once: true })

    let sent = 0
    const report = (n: number): void => {
      sent += n
      init.onProgress?.(sent, contentLength)
    }

    req.write(preamble)
    report(preamble.length)

    const stream = createReadStream(init.filePath)
    req.once('close', () => {
      stream.destroy()
      agent.destroy()
      init.signal?.removeEventListener('abort', onAbort)
    })
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      report(buf.length)
    })
    stream.on('error', (err) => {
      req.destroy(err)
      reject(err)
    })
    stream.on('end', () => {
      req.write(epilogue)
      report(epilogue.length)
      req.end()
    })
    stream.pipe(req, { end: false })

  })
}
