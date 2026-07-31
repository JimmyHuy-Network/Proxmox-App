import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './AppLayout'
import { Dashboard } from '../routes/Dashboard'
import { ConsolePage } from '../routes/ConsolePage'

const rootRoute = createRootRoute({ component: AppLayout })

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
})

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/console',
  component: ConsolePage,
})

const routeTree = rootRoute.addChildren([dashboardRoute, consoleRoute])

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
