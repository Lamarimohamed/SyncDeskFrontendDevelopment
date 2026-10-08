import { useMemo } from 'react'
import { RouterProvider } from 'react-router'
import { ToastProvider } from '@/components/ui/Toast'
import { ThemeProvider } from './ThemeProvider'
import { createAppRouter } from './router'

export default function App() {
  const router = useMemo(createAppRouter, [])
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  )
}
