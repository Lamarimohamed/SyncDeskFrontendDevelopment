import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/Toast'
import { authService } from '@/services/container'
import { onboardingStore } from '@/state/workspace'
import { routes } from './router'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  )
  return router
}

beforeEach(async () => {
  await authService.logout()
  onboardingStore.set({ completed: true })
})

describe('routing', () => {
  it('redirects protected routes to /login when signed out', async () => {
    const router = renderAt('/products')
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(router.state.location.pathname).toBe('/login')
  })

  it('signs in with the demo account and lands on the dashboard', async () => {
    const router = renderAt('/login')
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Demo' }))
    await screen.findByRole('navigation', { name: 'Primary' })
    expect(router.state.location.pathname).toBe('/dashboard')
  })

  it('sends first-time users to onboarding after login', async () => {
    onboardingStore.set({ completed: false })
    const router = renderAt('/login')
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Demo' }))
    await screen.findByRole('heading', { name: /welcome/i })
    expect(router.state.location.pathname).toBe('/onboarding')
  })

  it('shows the 404 page for unknown routes', async () => {
    renderAt('/nope')
    await screen.findByText('404')
  })

  it('validates the login form', async () => {
    renderAt('/login')
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
  })
})
