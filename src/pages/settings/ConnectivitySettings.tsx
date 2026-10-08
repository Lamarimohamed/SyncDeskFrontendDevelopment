import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePreferences } from '@/hooks/usePreferences'
import { useSyncSnapshot } from '@/hooks/useSync'
import { relativeTime } from '@/lib/format'
import { syncService } from '@/services/container'
import { SettingsSection } from './SettingsSection'

const labels = { online: 'Online', offline: 'Offline', connecting: 'Connecting' } as const
const tones = { online: 'success', offline: 'offline', connecting: 'info' } as const

export function ConnectivitySettings() {
  useDocumentTitle('Connectivity settings')
  const snap = useSyncSnapshot()
  const [prefs, set] = usePreferences()
  const [failReads, setFailReadsState] = useState(() => syncService.isFailingReads())

  return (
    <div>
      <SettingsSection title="Connection" description="The state of this device's link to the (simulated) sync service.">
        <dl className="grid max-w-md gap-3 sm:grid-cols-[160px_1fr]">
          <dt className="type-body text-fg2">Status</dt>
          <dd><Badge tone={tones[snap.connectivity]}>{labels[snap.connectivity]}</Badge></dd>
          <dt className="type-body text-fg2">Pending changes</dt>
          <dd className="type-body tabular text-fg">{snap.pending.length}</dd>
          <dt className="type-body text-fg2">Last sync</dt>
          <dd className="type-body text-fg">{snap.lastSyncAt ? relativeTime(snap.lastSyncAt) : 'Never'}</dd>
        </dl>
        {snap.connectivity === 'offline' ? (
          <Banner tone="offline" className="mt-4">
            You can keep working. Changes are saved on this device and will sync when the connection returns.
          </Banner>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Demo controls"
        description="These controls exist only to demonstrate offline behavior. They do not change your real network connection."
      >
        <Switch
          checked={prefs.showDevControls}
          onChange={(v) => set({ showDevControls: v })}
          label="Show demo controls panel"
          description="Display the floating demo panel across the app."
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={syncService.goOffline} disabled={snap.connectivity === 'offline'}>Go offline</Button>
          <Button onClick={syncService.goOnline} disabled={snap.connectivity === 'online'}>Go online</Button>
          <Button onClick={syncService.simulateSyncError}>Simulate sync error</Button>
        </div>
        <div className="mt-2 border-t border-line pt-1">
          <Switch
            checked={failReads}
            onChange={(v) => {
              syncService.setFailReads(v)
              setFailReadsState(v)
            }}
            label="Simulate repository read failure"
            description="Makes local data reads fail so you can see error states. Turn it off to restore normal behavior."
            badge={<Badge tone="warning">Demo</Badge>}
          />
        </div>
      </SettingsSection>
    </div>
  )
}
