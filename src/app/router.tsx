import { createBrowserRouter, Navigate, Outlet, useRouteError, type RouteObject } from 'react-router'
import { ButtonLink } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { logger } from '@/lib/logger'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/components/navigation/guards'
import { Skeleton } from '@/components/ui/Skeleton'

type Loader = () => Promise<Record<string, unknown>>

/** Lazy route helper: loads a named export as the route component. */
const page = (load: Loader, name: string): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load())[name] as React.ComponentType }),
})

function RouteFallback() {
  return (
    <div className="space-y-4 p-6" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function RootErrorElement() {
  const error = useRouteError()
  logger.error('UI', 'Route error', error)
  return (
    <div className="mx-auto max-w-lg py-24">
      <ErrorState
        title="This page could not be loaded"
        description="The app hit an unexpected error. Local data on this device is unchanged."
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
        actions={<ButtonLink to="/dashboard">Go to dashboard</ButtonLink>}
      />
    </div>
  )
}

const publicPages = {
  landing: () => import('@/pages/public/LandingPage'),
  login: () => import('@/pages/public/LoginPage'),
  forgot: () => import('@/pages/public/ForgotPasswordPage'),
  reset: () => import('@/pages/public/ResetPasswordPage'),
}
const errors = () => import('@/pages/errors/ErrorPages')
const products = {
  list: () => import('@/pages/products/ProductsPage'),
  detail: () => import('@/pages/products/ProductDetailPage'),
  editor: () => import('@/pages/products/ProductEditorPage'),
}
const sync = () => import('@/pages/sync/SyncPages')
const devices = () => import('@/pages/devices/DevicesPages')
const settings = () => import('@/pages/settings/SettingsPages')

export const routes: RouteObject[] = [
  { path: '/', ...page(publicPages.landing, 'LandingPage'), HydrateFallback: RouteFallback },
  { path: '/login', ...page(publicPages.login, 'LoginPage'), HydrateFallback: RouteFallback },
  { path: '/forgot-password', ...page(publicPages.forgot, 'ForgotPasswordPage'), HydrateFallback: RouteFallback },
  { path: '/reset-password', ...page(publicPages.reset, 'ResetPasswordPage'), HydrateFallback: RouteFallback },
  { path: '/offline', ...page(errors, 'OfflinePage') },
  { path: '/401', ...page(errors, 'UnauthorizedPage') },
  { path: '/403', ...page(errors, 'ForbiddenPage') },
  { path: '/404', ...page(errors, 'NotFoundPage') },
  { path: '/500', ...page(errors, 'ServerErrorPage') },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', ...page(() => import('@/pages/onboarding/OnboardingPage'), 'OnboardingPage') },
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', ...page(() => import('@/pages/dashboard/DashboardPage'), 'DashboardPage') },
          { path: '/products', ...page(products.list, 'ProductsPage') },
          { path: '/products/new', ...page(products.editor, 'ProductEditorPage') },
          { path: '/products/:productId', ...page(products.detail, 'ProductDetailPage') },
          { path: '/products/:productId/edit', ...page(products.editor, 'ProductEditorPage') },
          { path: '/categories', ...page(() => import('@/pages/categories/CategoriesPage'), 'CategoriesPage') },
          { path: '/stock', ...page(() => import('@/pages/stock/StockPage'), 'StockPage') },
          { path: '/stock/adjust', ...page(() => import('@/pages/stock/StockPage'), 'StockPage') },
          { path: '/sync', ...page(sync, 'SyncStatusPage') },
          { path: '/sync/activity', ...page(sync, 'SyncActivityPage') },
          { path: '/sync/pending', ...page(sync, 'SyncPendingPage') },
          { path: '/devices', ...page(devices, 'DevicesPage') },
          { path: '/devices/:deviceId', ...page(devices, 'DeviceDetailPage') },
          {
            path: '/settings',
            ...page(settings, 'SettingsLayout'),
            children: [
              { index: true, element: <Navigate to="profile" replace /> },
              { path: 'profile', ...page(settings, 'ProfileSettings') },
              { path: 'workspace', ...page(settings, 'WorkspaceSettings') },
              { path: 'synchronization', ...page(settings, 'SynchronizationSettings') },
              { path: 'connectivity', ...page(settings, 'ConnectivitySettings') },
              { path: 'appearance', ...page(settings, 'AppearanceSettings') },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', ...page(errors, 'NotFoundPage') },
]

export const createAppRouter = () => createBrowserRouter([{ element: <Outlet />, errorElement: <RootErrorElement />, children: routes }])
