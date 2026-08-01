import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { iterateEndpoints, loadSchema } from '@pve/schema'
import type { PveEndpointMeta, PveHttpMethod } from '@pve/schema'
import { authenticate, type AuthContext, type AuthStore } from './auth.ts'
import { fakeFromReturns } from './faker.ts'
import type { MockContext } from './context.ts'

/**
 * Định tuyến theo schema.
 *
 * Mọi endpoint trong `pve-9.2.schema.json` đều được đăng ký. Với mỗi request:
 *
 *   1. kiểm xác thực (cookie ticket hoặc PVEAPIToken), tôn trọng cờ allowToken
 *   2. kiểm tham số theo schema  ← chỗ này bắt lỗi của CHÍNH client bạn
 *   3. gọi handler riêng nếu có
 *   4. nếu không, tự sinh phản hồi đúng hình dạng `returns`
 *   5. bọc trong { data: ... }
 *
 * Bước 2 khiến mock **nghiêm khắc hơn Proxmox thật** — nó bắt được payload sai mà
 * nếu không thì phải có phần cứng mới lộ ra.
 */

export type HandlerResult = unknown
export type MockHandler = (ctx: {
  params: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
  /** Tham số đường dẫn và tham số thường đã gộp lại, tiện dùng nhất. */
  input: Record<string, unknown>
  auth: AuthContext
  mock: MockContext
  reply: FastifyReply
}) => HandlerResult | Promise<HandlerResult>

export type HandlerTable = Record<string, MockHandler>

/** Khoá handler: `"POST /nodes/{node}/qemu/{vmid}/status/start"`. */
export function handlerKey(method: PveHttpMethod, path: string): string {
  return `${method} ${path}`
}

/** Chuyển `{node}` của Proxmox thành `:node` của Fastify. Tên có thể chứa gạch ngang. */
function toFastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_m, name: string) => `:${name.replaceAll('-', '_')}`)
}

/** Ánh xạ ngược tên tham số Fastify về tên gốc của Proxmox. */
function paramNameMap(pathParams: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const name of pathParams) map[name.replaceAll('-', '_')] = name
  return map
}

class HttpError extends Error {
  readonly status: number
  readonly fieldErrors: Record<string, string> | undefined

  constructor(status: number, message: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

/**
 * Những endpoint không cần đăng nhập.
 *
 * Đối chiếu với PVE 9.2.2 thật: **chỉ đúng hai** endpoint này là public. `/version`
 * trông có vẻ vô hại nhưng máy chủ thật trả 401 khi chưa đăng nhập — từng để nó
 * public là mock dễ dãi hơn thật, che mất lỗi gọi thiếu xác thực.
 */
const PUBLIC_ENDPOINTS = new Set(['POST /access/ticket', 'GET /access/domains'])

export function registerSchemaRoutes(
  app: FastifyInstance,
  mock: MockContext,
  handlers: HandlerTable,
  authStore: AuthStore,
): number {
  const schema = loadSchema()
  let registered = 0

  for (const { path, entry, meta } of iterateEndpoints(schema)) {
    const key = handlerKey(meta.method, path)
    const fastifyPath = `/api2/json${toFastifyPath(path)}`
    const nameMap = paramNameMap(entry.pathParams)

    app.route({
      method: meta.method,
      url: fastifyPath,
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          return await dispatch(request, reply, { path, meta, key, nameMap })
        } catch (error) {
          if (error instanceof HttpError) {
            void reply.status(error.status)
            return error.fieldErrors
              ? { data: null, errors: error.fieldErrors }
              : { data: null, message: error.message }
          }
          request.log.error(error)
          void reply.status(500)
          return { data: null, message: error instanceof Error ? error.message : 'lỗi không rõ' }
        }
      },
    })

    registered += 1
  }

  async function dispatch(
    request: FastifyRequest,
    reply: FastifyReply,
    route: {
      path: string
      meta: PveEndpointMeta
      key: string
      nameMap: Record<string, string>
    },
  ): Promise<unknown> {
    const { path, meta, key, nameMap } = route

    // Độ trễ giả lập — mặc định khác 0 để không ai xây giao diện chỉ mượt ở 0 ms.
    const delay = mock.latency()
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

    const failure = mock.takeInjectedFailure(meta.method, path)
    if (failure) throw new HttpError(failure.status, failure.message)

    let auth: AuthContext | null = null
    if (!PUBLIC_ENDPOINTS.has(key)) {
      auth = authenticate(authStore, request)
      if (!auth) throw new HttpError(401, 'authentication failure')

      if (auth.kind === 'token' && !meta.allowToken) {
        throw new HttpError(403, `Permission check failed - API token not allowed for ${meta.name}`)
      }

      // Proxmox yêu cầu CSRF token cho mọi thao tác ghi khi dùng ticket.
      if (auth.kind === 'ticket' && meta.method !== 'GET') {
        const header = request.headers['csrfpreventiontoken']
        if (header !== auth.csrfToken) {
          throw new HttpError(401, 'CSRF prevention token missing or invalid')
        }
      }
    }

    // Trả tên tham số về đúng dạng gốc: Fastify không nhận `:pci-id-or-mapping`.
    const rawParams = (request.params ?? {}) as Record<string, string>
    const params: Record<string, string> = {}
    for (const [safe, value] of Object.entries(rawParams)) {
      params[nameMap[safe] ?? safe] = value
    }

    const query = (request.query ?? {}) as Record<string, unknown>
    const body = (request.body ?? {}) as Record<string, unknown>
    const input = { ...query, ...body, ...params }

    validateAgainstSchema(meta, input)

    const handler = handlers[key]
    if (handler) {
      const result = await handler({
        params,
        query,
        body,
        input,
        auth: auth ?? { kind: 'ticket', username: 'root@pam' },
        mock,
        reply,
      })
      return { data: result ?? null }
    }

    return { data: fakeFromReturns(meta.returns, key) }
  }

  return registered
}

/**
 * Kiểm tham số theo schema chính thức.
 *
 * Nghiêm khắc hơn Proxmox thật một cách có chủ đích: nếu client gửi thiếu tham số
 * bắt buộc hay sai giá trị enum thì lỗi phải nổ ra ngay trên máy phát triển, chứ
 * không phải đợi tới lúc gặp phần cứng thật.
 */
function validateAgainstSchema(meta: PveEndpointMeta, input: Record<string, unknown>): void {
  const errors: Record<string, string> = {}

  for (const [name, spec] of Object.entries(meta.params)) {
    // Tham số đánh số (`net[n]`) không kiểm ở đây — chúng tới dưới dạng net0, net1…
    if (name.endsWith('[n]')) continue

    const value = input[name]

    if (!spec.optional && (value === undefined || value === null || value === '')) {
      errors[name] = 'parameter is missing'
      continue
    }
    if (value === undefined || value === null) continue

    if (spec.enum && spec.enum.length > 0 && !spec.enum.includes(String(value))) {
      errors[name] = `value '${String(value)}' is not a valid enum value`
      continue
    }

    if (spec.type === 'integer' || spec.type === 'number') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) {
        errors[name] = 'type check failed - expected a number'
        continue
      }
      if (spec.minimum !== undefined && numeric < spec.minimum) {
        errors[name] = `value must be at least ${spec.minimum}`
        continue
      }
      if (spec.maximum !== undefined && numeric > spec.maximum) {
        errors[name] = `value must be at most ${spec.maximum}`
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new HttpError(400, 'Parameter verification failed.', errors)
  }
}

export { HttpError }
