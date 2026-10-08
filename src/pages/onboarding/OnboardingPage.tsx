import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Check } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/cn'
import { preferencesStore } from '@/state/preferences'
import { onboardingStore, workspaceStore } from '@/state/workspace'

const STEPS = ['Welcome', 'Workspace', 'Device', 'Synchronization', 'Ready'] as const

interface Draft {
  name: string
  threshold: string
  deviceName: string
  autoSync: boolean
}

export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const workspace = useStore(workspaceStore)
  const prefs = useStore(preferencesStore)
  const completedBefore = useStore(onboardingStore).completed
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<Draft>(() => ({
    name: workspace.name,
    threshold: String(workspace.defaultLowStockThreshold),
    deviceName: workspace.deviceName,
    autoSync: prefs.autoSync,
  }))
  const [errors, setErrors] = useState<{ name?: string; threshold?: string; deviceName?: string }>({})
  const headingRef = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  useDocumentTitle(`Set up · ${STEPS[step]}`)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    headingRef.current?.focus()
  }, [step])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  function validate(): boolean {
    const next: typeof errors = {}
    if (step === 1) {
      if (!draft.name.trim()) next.name = 'Give the workspace a name.'
      const t = Number(draft.threshold)
      if (draft.threshold.trim() === '' || !Number.isInteger(t) || t < 0) next.threshold = 'Enter a whole number, 0 or more.'
    }
    if (step === 2 && !draft.deviceName.trim()) next.deviceName = 'Give this device a name.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function finish() {
    workspaceStore.set({
      name: draft.name.trim(),
      deviceName: draft.deviceName.trim(),
      defaultLowStockThreshold: Number(draft.threshold),
    })
    preferencesStore.set({ autoSync: draft.autoSync })
    onboardingStore.set({ completed: true })
    navigate('/dashboard')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!validate()) return
    if (step === STEPS.length - 1) finish()
    else setStep(step + 1)
  }

  const last = step === STEPS.length - 1

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-16 items-center justify-between px-4 sm:px-6">
        <Logo />
        {completedBefore ? (
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>Exit setup</Button>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-16 sm:px-6">
        <nav aria-label="Setup progress" className="mt-2">
          <p className="type-caption text-muted sm:hidden">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
          <ol className="mt-2 flex gap-1.5 sm:mt-0 sm:gap-3">
            {STEPS.map((label, i) => {
              const state = i < step ? 'done' : i === step ? 'current' : 'todo'
              return (
                <li key={label} className="flex-1" aria-current={state === 'current' ? 'step' : undefined}>
                  <span
                    aria-hidden
                    className={cn('block h-1 rounded-full', state === 'todo' ? 'bg-line' : 'bg-primary')}
                  />
                  <span className={cn('type-caption mt-2 hidden items-center gap-1 sm:flex', state === 'current' ? 'font-medium text-fg' : 'text-muted')}>
                    {state === 'done' ? <Check aria-hidden className="size-3" /> : null}
                    {label}
                    {state === 'done' ? <span className="sr-only"> (completed)</span> : null}
                  </span>
                </li>
              )
            })}
          </ol>
        </nav>

        <form onSubmit={onSubmit} noValidate className="mt-10">
          {step === 0 ? (
            <section aria-labelledby="step-title" className="space-y-4">
              <h1 id="step-title" ref={headingRef} tabIndex={-1} className="type-h1 outline-none">
                Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}
              </h1>
              <p className="type-body-lg text-fg2">
                A few quick choices before you start. Setup takes about a minute and everything can be changed later in Settings.
              </p>
              <ul className="type-body list-disc space-y-1 ps-5 text-fg2">
                <li>Name your workspace and pick stock defaults.</li>
                <li>Name this device so it is recognizable in the device list.</li>
                <li>Decide how synchronization behaves.</li>
              </ul>
            </section>
          ) : null}

          {step === 1 ? (
            <section aria-labelledby="step-title" className="space-y-5">
              <div>
                <h1 id="step-title" ref={headingRef} tabIndex={-1} className="type-h1 outline-none">Your workspace</h1>
                <p className="type-body mt-1 text-fg2">These are shown across the app and used as stock defaults.</p>
              </div>
              <Field label="Workspace name" error={errors.name}>
                <Input value={draft.name} autoFocus maxLength={60} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="Currency" helper="The demo supports Algerian dinar (DA) only.">
                <Input value="DA" readOnly disabled />
              </Field>
              <Field
                label="Default low-stock threshold"
                error={errors.threshold}
                helper="Products at or below this quantity are flagged as low stock unless they set their own."
              >
                <Input type="number" inputMode="numeric" min={0} step={1} value={draft.threshold} onChange={(e) => patch({ threshold: e.target.value })} />
              </Field>
            </section>
          ) : null}

          {step === 2 ? (
            <section aria-labelledby="step-title" className="space-y-5">
              <div>
                <h1 id="step-title" ref={headingRef} tabIndex={-1} className="type-h1 outline-none">This device</h1>
                <p className="type-body mt-1 text-fg2">
                  Each device holds its own replica of the data and is identified by this name in the device list.
                </p>
              </div>
              <Field label="Device name" error={errors.deviceName} helper="For example: Counter tablet, Kitchen screen.">
                <Input value={draft.deviceName} autoFocus maxLength={40} onChange={(e) => patch({ deviceName: e.target.value })} />
              </Field>
            </section>
          ) : null}

          {step === 3 ? (
            <section aria-labelledby="step-title" className="space-y-4">
              <div>
                <h1 id="step-title" ref={headingRef} tabIndex={-1} className="type-h1 outline-none">Synchronization</h1>
                <p className="type-body mt-1 text-fg2">
                  SyncDesk is offline-first. Every change is saved on this device immediately, whether or not you are connected. Changes made offline wait in a queue and are merged with other devices once the connection returns.
                </p>
              </div>
              <div className="rounded-card border border-line bg-surface px-4">
                <Switch
                  checked={draft.autoSync}
                  onChange={(v) => patch({ autoSync: v })}
                  label="Sync automatically when online"
                  description="When off, changes stay queued until you choose Sync now. Nothing is lost either way."
                />
              </div>
              <p className="type-body-sm text-muted">
                In this demonstrator the other devices and the network transport are simulated in your browser.
              </p>
            </section>
          ) : null}

          {step === 4 ? (
            <section aria-labelledby="step-title" className="space-y-5">
              <div>
                <h1 id="step-title" ref={headingRef} tabIndex={-1} className="type-h1 outline-none">Ready to go</h1>
                <p className="type-body mt-1 text-fg2">Here is what will be saved.</p>
              </div>
              <dl className="divide-y divide-line border-y border-line">
                {[
                  ['Workspace', draft.name.trim()],
                  ['Currency', 'DA'],
                  ['Low-stock threshold', draft.threshold],
                  ['Device', draft.deviceName.trim()],
                  ['Automatic sync', draft.autoSync ? 'On' : 'Off'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 py-3">
                    <dt className="type-body text-fg2">{k}</dt>
                    <dd className="type-body min-w-0 truncate text-end font-medium text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <div className="mt-10 flex items-center justify-between gap-3">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
            <Button type="submit" variant="primary" size="lg" className="max-sm:min-w-32">
              {last ? 'Open dashboard' : 'Next'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
