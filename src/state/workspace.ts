import { createPersistedStore } from '@/lib/store'

export interface WorkspaceSettings {
  name: string
  deviceName: string
  currency: 'DA'
  defaultLowStockThreshold: number
}

export const workspaceStore = createPersistedStore<WorkspaceSettings>('syncdesk.workspace.v1', {
  name: 'Demo Workspace',
  deviceName: 'Counter tablet',
  currency: 'DA',
  defaultLowStockThreshold: 10,
})

export interface OnboardingState {
  completed: boolean
}

export const onboardingStore = createPersistedStore<OnboardingState>('syncdesk.onboarding.v1', { completed: false })
