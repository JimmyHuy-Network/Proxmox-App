import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PveHttpMethod } from '@pve/schema'
import { TaskEngine } from './tasks/engine.ts'
import { World, type MockWorld } from './state/world.ts'
import { AuthStore } from './auth.ts'
import { ConsoleTicketStore } from './console/tickets.ts'
import { defaultNodeInfra, defaultCephState, type NodeInfraState, type MockCephState, type MockClusterConfig } from './state/node-infra.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, '..', 'fixtures')

export const FIXTURES = ['cluster-3node', 'huge', 'broken-cluster'] as const
export type FixtureName = (typeof FIXTURES)[number]

interface InjectedFailure {
  method: PveHttpMethod
  path: string
  status: number
  message: string
  remaining: number
}

/**
 * Trạng thái dùng chung của máy chủ giả lập, cộng các cần gạt để thao túng nó
 * từ bên ngoài qua API điều khiển `/__mock/`.
 *
 * Mấy cần gạt này không phải để cho vui: có thể tiêm độ trễ, ép lỗi, và cho một
 * node ngừng hoạt động chỉ bằng một lời gọi — đó là cách duy nhất dựng được giao
 * diện cho các trạng thái hỏng hóc khi trong tay không có cụm máy thật để phá.
 */
export interface MockAcl {
  path: string
  ugid: string
  type: 'user' | 'group' | 'token'
  roleid: string
  propagate?: number
}

const SEED_ACLS: MockAcl[] = [
  { path: '/', ugid: 'root@pam', type: 'user', roleid: 'Administrator', propagate: 1 },
  { path: '/vms/100', ugid: 'root@pam', type: 'user', roleid: 'PVEVMAdmin', propagate: 1 },
  { path: '/vms/200', ugid: 'root@pam', type: 'user', roleid: 'PVEVMAdmin', propagate: 1 },
]

export class MockContext {
  readonly world: World
  readonly tasks = new TaskEngine()
  readonly auth = new AuthStore()
  /** Vé console (termproxy/vncproxy) — GĐ 5. */
  readonly consoleTickets = new ConsoleTicketStore()
  /** ACL trong bộ nhớ — đủ cho tab quyền theo guest (GĐ 4); Access đầy đủ là GĐ 8. */
  acls: MockAcl[] = structuredClone(SEED_ACLS)
  /** Hạ tầng node (mạng/DNS/hosts/time/disks/apt…) — GĐ 7. */
  private nodeInfra = new Map<string, NodeInfraState>()
  /** Ceph cụm — GĐ 7. */
  ceph: MockCephState = defaultCephState(['pve1', 'pve2', 'pve3'])
  /** Cluster create/join — GĐ 7. */
  clusterConfig: MockClusterConfig = {
    created: true,
    clustername: 'pve-lab',
    nodes: ['pve1', 'pve2', 'pve3'],
  }

  private latencyMs = 40
  private latencyJitter = 40
  private failures: InjectedFailure[] = []

  constructor(fixture: FixtureName = 'cluster-3node') {
    this.world = new World(loadFixture(fixture))
    this.seedNodeInfra()
    this.seedClusterExtras(fixture)
    this.tasks.start()
  }

  loadFixture(name: FixtureName): void {
    this.world.load(loadFixture(name))
    this.tasks.reset()
    this.seedNodeInfra()
    this.seedClusterExtras(name)
  }

  reset(): void {
    this.world.reset()
    this.tasks.reset()
    this.auth.reset()
    this.consoleTickets.reset()
    this.acls = structuredClone(SEED_ACLS)
    this.failures = []
    this.seedNodeInfra()
    this.seedClusterExtras(undefined)
  }

  ensureNodeInfra(node: string): NodeInfraState {
    let state = this.nodeInfra.get(node)
    if (!state) {
      const index = this.world.current.nodes.findIndex((n) => n.node === node)
      state = defaultNodeInfra(node, Math.max(0, index))
      this.nodeInfra.set(node, state)
    }
    return state
  }

  private seedNodeInfra(): void {
    this.nodeInfra.clear()
    this.world.current.nodes.forEach((n, index) => {
      this.nodeInfra.set(n.node, defaultNodeInfra(n.node, index))
    })
  }

  private seedClusterExtras(fixture?: FixtureName): void {
    const nodes = this.world.current.nodes.map((n) => n.node)
    const name = fixture ?? (this.world.current.clusterName === 'broken-cluster' ? 'broken-cluster' : undefined)
    const broken = name === 'broken-cluster' || this.world.current.clusterName === 'broken-lab'
    this.ceph = defaultCephState(nodes, broken)
    this.clusterConfig = {
      created: true,
      clustername: this.world.current.clusterName,
      nodes: [...nodes],
    }
  }

  setLatency(ms: number, jitter = 0): void {
    this.latencyMs = Math.max(0, ms)
    this.latencyJitter = Math.max(0, jitter)
  }

  latency(): number {
    if (this.latencyMs === 0 && this.latencyJitter === 0) return 0
    return this.latencyMs + Math.floor(Math.random() * (this.latencyJitter + 1))
  }

  injectFailure(failure: Omit<InjectedFailure, 'remaining'> & { count?: number }): void {
    this.failures.push({ ...failure, remaining: failure.count ?? 1 })
  }

  /** Lấy ra một lỗi đã tiêm cho endpoint này, nếu có, và trừ đi một lượt. */
  takeInjectedFailure(
    method: PveHttpMethod,
    path: string,
  ): { status: number; message: string } | null {
    const index = this.failures.findIndex((f) => f.method === method && f.path === path)
    if (index < 0) return null

    const failure = this.failures[index] as InjectedFailure
    failure.remaining -= 1
    if (failure.remaining <= 0) this.failures.splice(index, 1)

    return { status: failure.status, message: failure.message }
  }

  setNodeOffline(node: string, offline: boolean): boolean {
    const target = this.world.node(node)
    if (!target) return false
    target.status = offline ? 'offline' : 'online'
    return true
  }

  stop(): void {
    this.tasks.stop()
  }
}

function loadFixture(name: string): MockWorld {
  const path = join(fixturesDir, `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as MockWorld
}
