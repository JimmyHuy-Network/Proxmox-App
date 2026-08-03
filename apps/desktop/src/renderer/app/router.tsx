import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './AppLayout'
import { Dashboard } from '../routes/Dashboard'
import { ConsolePage } from '../routes/ConsolePage'
import { ConsoleSessionPage } from '../routes/ConsoleSessionPage'
import { ClusterLogPage } from '../routes/ClusterLogPage'
import { ConnectionsPage } from '../features/connections/ConnectionsPage'
import { ClusterPage } from '../features/cluster/ClusterPage'
import { AccessPage } from '../features/access/AccessPage'
import { FirewallPage } from '../features/firewall/FirewallPage'
import { DatacenterExtrasPage } from '../features/datacenter/DatacenterExtrasPage'
import { SettingsPage } from '../features/settings/SettingsPage'

const rootRoute = createRootRoute({ component: AppLayout })

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
})

const connectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connections',
  component: ConnectionsPage,
})

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/console',
  component: ConsolePage,
})

const consoleSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/console/session',
  component: ConsoleSessionPage,
})

const clusterLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cluster-log',
  component: ClusterLogPage,
})

const clusterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cluster',
  component: ClusterPage,
})

const accessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/access',
  component: AccessPage,
})

const firewallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/firewall',
  component: FirewallPage,
})

const datacenterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/datacenter',
  component: DatacenterExtrasPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  connectionsRoute,
  consoleRoute,
  consoleSessionRoute,
  clusterLogRoute,
  clusterRoute,
  accessRoute,
  firewallRoute,
  datacenterRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  // Bắt buộc dùng hash history: bản đóng gói nạp renderer qua `file://`, mà
  // history dạng đường dẫn sẽ hỏng ngay khi tải lại trang.
  history: createHashHistory(),
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
