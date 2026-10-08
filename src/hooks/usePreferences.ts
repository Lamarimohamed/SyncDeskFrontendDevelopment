import { preferencesStore, type Preferences } from '@/state/preferences'
import { useStore } from '@/lib/store'

export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  return [useStore(preferencesStore), preferencesStore.set]
}
