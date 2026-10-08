import { Switch } from '@/components/ui/Switch'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePreferences } from '@/hooks/usePreferences'
import { RadioGroup, SettingsSection } from './SettingsSection'

export function AppearanceSettings() {
  useDocumentTitle('Appearance settings')
  const [prefs, set] = usePreferences()
  return (
    <div>
      <SettingsSection title="Theme" description="Applied immediately and remembered on this device.">
        <RadioGroup
          legend="Theme"
          name="theme"
          value={prefs.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System', description: 'Follow device setting' },
          ]}
        />
      </SettingsSection>
      <SettingsSection title="Direction" description="Layout direction for the whole app.">
        <RadioGroup
          legend="Layout direction"
          name="direction"
          value={prefs.direction}
          onChange={(direction) => set({ direction })}
          options={[
            { value: 'ltr', label: 'Left to right' },
            { value: 'rtl', label: 'Right to left' },
          ]}
        />
        <p className="type-body-sm mt-3 max-w-xl text-muted">
          Arabic product names and descriptions are always displayed right to left, whichever layout direction you choose.
        </p>
      </SettingsSection>
      <SettingsSection title="Motion">
        <Switch
          checked={prefs.reducedMotion}
          onChange={(v) => set({ reducedMotion: v })}
          label="Reduce motion"
          description="Minimize animations and transitions. Your device's reduced-motion setting is also respected."
        />
      </SettingsSection>
    </div>
  )
}
