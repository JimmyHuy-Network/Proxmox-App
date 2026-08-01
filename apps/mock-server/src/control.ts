import type { FastifyInstance } from 'fastify'
import type { PveHttpMethod } from '@pve/schema'
import { FIXTURES, type FixtureName, type MockContext } from './context.ts'

/**
 * API điều khiển, chỉ dành cho phát triển.
 *
 * Nằm ngoài `/api2` nên không bao giờ đụng vào bề mặt API thật của Proxmox.
 *
 * Đây là cách dựng giao diện cho các trạng thái hỏng hóc khi trong tay không có
 * cụm máy thật để phá: cho một node offline bằng một lời gọi rồi xem cây tài nguyên
 * phản ứng ra sao, hoặc ép một endpoint trả 500 để kiểm đường báo lỗi.
 */
export function registerControlApi(app: FastifyInstance, mock: MockContext): void {
  app.post('/__mock/reset', async () => {
    mock.reset()
    return { ok: true, message: 'Đã đưa trạng thái về ban đầu' }
  })

  app.get('/__mock/fixtures', async () => ({ fixtures: FIXTURES }))

  app.post<{ Params: { name: string } }>('/__mock/scenario/:name', async (request, reply) => {
    const name = request.params.name as FixtureName
    if (!FIXTURES.includes(name)) {
      void reply.status(404)
      return { ok: false, message: `Kịch bản không tồn tại: ${name}` }
    }
    mock.loadFixture(name)
    return { ok: true, message: `Đã nạp kịch bản ${name}` }
  })

  app.post<{ Body: { ms?: number; jitter?: number } }>('/__mock/latency', async (request) => {
    const { ms = 0, jitter = 0 } = request.body ?? {}
    mock.setLatency(ms, jitter)
    return { ok: true, message: `Độ trễ: ${ms} ms ± ${jitter} ms` }
  })

  app.post<{
    Body: { method?: string; path?: string; status?: number; message?: string; count?: number }
  }>('/__mock/fail', async (request, reply) => {
    const { method, path, status = 500, message = 'lỗi được tiêm vào', count = 1 } = request.body ?? {}

    if (!method || !path) {
      void reply.status(400)
      return { ok: false, message: 'Cần có method và path' }
    }

    mock.injectFailure({
      method: method.toUpperCase() as PveHttpMethod,
      path,
      status,
      message,
      count,
    })
    return { ok: true, message: `${method} ${path} sẽ lỗi ${count} lần với mã ${status}` }
  })

  app.post<{ Params: { node: string }; Body: { offline?: boolean } }>(
    '/__mock/node/:node/offline',
    async (request, reply) => {
      const offline = request.body?.offline ?? true
      if (!mock.setNodeOffline(request.params.node, offline)) {
        void reply.status(404)
        return { ok: false, message: `Không có node ${request.params.node}` }
      }
      return {
        ok: true,
        message: `Node ${request.params.node} giờ ${offline ? 'offline' : 'online'}`,
      }
    },
  )

  app.get('/__mock/state', async () => {
    const world = mock.world.current
    return {
      cluster: world.clusterName,
      nodes: world.nodes.map((n) => ({ node: n.node, status: n.status })),
      guests: world.guests.map((g) => ({
        vmid: g.vmid,
        name: g.name,
        type: g.type,
        node: g.node,
        status: g.status,
      })),
      tasks: mock.tasks.list().length,
    }
  })
}
