import { createPersistedStore } from '@/lib/store'

export type ThemePreference = 'light' | 'dark' | 'system'
export type Direction = 'ltr' | 'rtl'

export interface Preferences {
  theme: ThemePreference
  reducedMotion: boolean
  direction: Direction
  autoSync: boolean
  autoRetry: boolean
  diagnosticsOpenByDefault: boolean
  technicalMode: boolean
  showDevControls: boolean
}

export const preferencesStore = createPersistedStore<Preferences>('syncdesk.preferences.v1', {
  theme: 'system',
  reducedMotion: false,
  direction: 'ltr',
  autoSync: true,
  autoRetry: true,
  diagnosticsOpenByDefault: false,
  technicalMode: false,
  showDevControls: true,
})
