import { Switch } from '@/components/ui/Switch'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePreferences } from '@/hooks/usePreferences'
import { SettingsSection } from './SettingsSection'

export function SynchronizationSettings() {
  useDocumentTitle('Synchronization settings')
  const [prefs, set] = usePreferences()
  return (
    <div>
      <SettingsSection
        title="Synchronization"
        description="Changes are always saved on this device first. These options control when they are sent to other devices. In this demonstrator the transport is simulated."
      >
        <div className="divide-y divide-line">
          <Switch
            checked={prefs.autoSync}
            onChange={(v) => set({ autoSync: v })}
            label="Sync automatically"
            description="Send queued changes as soon as the connection is available. When off, use Sync now; changes stay queued meanwhile."
          />
          <Switch
            checked={prefs.autoRetry}
            onChange={(v) => set({ autoRetry: v })}
            label="Retry failed syncs"
            description="After a failed sync, try again automatically after a short delay (about 5 seconds)."
          />
        </div>
      </SettingsSection>
      <SettingsSection title="Diagnostics" description="How much technical detail the sync pages show.">
        <div className="divide-y divide-line">
          <Switch
            checked={prefs.diagnosticsOpenByDefault}
            onChange={(v) => set({ diagnosticsOpenByDefault: v })}
            label="Open diagnostics by default"
            description="Expand the diagnostics panel on sync pages instead of keeping it collapsed."
          />
          <Switch
            checked={prefs.technicalMode}
            onChange={(v) => set({ technicalMode: v })}
            label="Technical mode"
            description="Show replica identifiers, CRDT types and byte counters where available. Some values are simulated and are labelled as such."
          />
        </div>
      </SettingsSection>
    </div>
  )
}
