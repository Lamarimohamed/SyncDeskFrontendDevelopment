import { useSyncExternalStore } from 'react'
import type { User } from '@/domain/types'
import { authService } from '@/services/container'

export function useAuth() {
  const user = useSyncExternalStore<User | null>(authService.subscribe, authService.getSnapshot, authService.getSnapshot)
  return { user, isAuthenticated: user !== null, service: authService }
}
