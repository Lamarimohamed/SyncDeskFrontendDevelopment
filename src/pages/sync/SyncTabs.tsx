import type { ReactNode } from 'react'
import { NavTabs } from '@/components/ui/Tabs'
import { PageHeader } from '@/components/layout/PageHeader'
import { useSyncSnapshot } from '@/hooks/useSync'
import { Badge } from '@/components/ui/Badge'
import type { MetricProvenance } from '@/domain/sync'

export function SyncTabs() {
  const { pending } = useSyncSnapshot()
  return (
    <NavTabs
      label="Synchronization sections"
      items={[
        { to: '/sync', label: 'Status', end: true },
        { to: '/sync/activity', label: 'Activity' },
        { to: '/sync/pending', label: 'Pending', count: pending.length },
      ]}
    />
  )
}

export function SyncPageFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <PageHeader title={title} description={description} actions={actions} documentTitle={`${title} · Synchronization`} />
      <div className="mb-6">
        <SyncTabs />
      </div>
      {children}
    </div>
  )
}

const provenanceLabel: Record<MetricProvenance, string> = {
  real: 'Real',
  simulated: 'Simulation metric',
  unavailable: 'Not available',
}

export function ProvenanceTag({ kind }: { kind: MetricProvenance }) {
  return (
    <Badge tone={kind === 'real' ? 'success' : kind === 'simulated' ? 'info' : 'neutral'}>{provenanceLabel[kind]}</Badge>
  )
}
