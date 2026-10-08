import { useState } from 'react'
import { History } from 'lucide-react'
import type { ActivityKind } from '@/domain/sync'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ActivityItem } from '@/components/sync/ActivityItem'
import { useSyncSnapshot } from '@/hooks/useSync'
import { cn } from '@/lib/cn'
import { SyncPageFrame } from './SyncTabs'

type Group = 'all' | 'local' | 'connection' | 'merge' | 'errors'

const groups: { id: Group; label: string; kinds: ActivityKind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'local', label: 'Local changes', kinds: ['change-created', 'change-queued'] },
  { id: 'connection', label: 'Connection', kinds: ['connection-lost', 'connection-restored', 'device'] },
  {
    id: 'merge',
    label: 'Merge & sync',
    kinds: ['sync-started', 'state-received', 'merge-completed', 'converged', 'remote-applied', 'conflict'],
  },
  { id: 'errors', label: 'Errors', kinds: ['sync-failed'] },
]

export function SyncActivityPage() {
  const snap = useSyncSnapshot()
  const [group, setGroup] = useState<Group>('all')
  const kinds = groups.find((g) => g.id === group)?.kinds ?? null
  const events = [...snap.activity].sort((a, b) => b.at - a.at).filter((e) => !kinds || kinds.includes(e.kind))

  return (
    <SyncPageFrame title="Synchronization activity" description="What happened on this device, newest first. Times are local clock times.">
      <div role="group" aria-label="Filter activity" className="mb-4 flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={group === g.id}
            onClick={() => setGroup(g.id)}
            className={cn(
              'type-label h-9 rounded-full border px-3 transition-colors duration-150 max-sm:min-h-10',
              group === g.id ? 'border-primary bg-primary-soft text-primary-text' : 'border-line bg-surface text-fg2 hover:bg-subtle',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      <Card>
        {events.length === 0 ? (
          <EmptyState
            icon={History}
            title={group === 'all' ? 'No activity yet' : 'No matching activity'}
            description={
              group === 'all'
                ? 'Events appear here when you edit data, lose or regain connection, or synchronize.'
                : 'Nothing in this category has happened yet.'
            }
            actions={
              group !== 'all' ? (
                <button type="button" onClick={() => setGroup('all')} className="type-label text-primary-text hover:underline">
                  Show all activity
                </button>
              ) : undefined
            }
          />
        ) : (
          <ol aria-label="Activity timeline" className="p-4 sm:p-5">
            {events.map((e, i) => (
              <ActivityItem key={e.id} event={e} time="clock" last={i === events.length - 1} />
            ))}
          </ol>
        )}
      </Card>
    </SyncPageFrame>
  )
}
