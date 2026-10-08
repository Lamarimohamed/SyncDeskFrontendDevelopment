import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { onboardingStore } from '@/state/workspace'

function ReplicaSchematic() {
  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 480 260"
        role="img"
        aria-labelledby="schematic-title schematic-desc"
        className="h-auto w-full text-fg2"
      >
        <title id="schematic-title">Two replicas converging</title>
        <desc id="schematic-desc">
          Replica A and replica B each accept edits while disconnected. When the connection returns, their changes are merged and both replicas hold the same state.
        </desc>
        {/* replica A */}
        <rect x="16" y="24" width="150" height="86" rx="10" className="fill-surface stroke-line-strong" strokeWidth="1.5" />
        <text x="32" y="50" className="fill-fg" fontSize="13" fontWeight="600">Replica A</text>
        <text x="32" y="72" className="fill-muted" fontSize="12">price = 450</text>
        <text x="32" y="92" className="fill-muted" fontSize="12">stock +3</text>
        {/* replica B */}
        <rect x="16" y="150" width="150" height="86" rx="10" className="fill-surface stroke-line-strong" strokeWidth="1.5" />
        <text x="32" y="176" className="fill-fg" fontSize="13" fontWeight="600">Replica B</text>
        <text x="32" y="198" className="fill-muted" fontSize="12">price = 470</text>
        <text x="32" y="218" className="fill-muted" fontSize="12">stock -2</text>
        {/* disconnected paths */}
        <path d="M166 67 H230 C250 67 250 130 270 130" fill="none" className="stroke-primary" strokeWidth="2" strokeDasharray="5 5" />
        <path d="M166 193 H230 C250 193 250 130 270 130" fill="none" className="stroke-primary" strokeWidth="2" strokeDasharray="5 5" />
        <text x="206" y="58" className="fill-muted" fontSize="11" textAnchor="middle">queued</text>
        <text x="206" y="214" className="fill-muted" fontSize="11" textAnchor="middle">queued</text>
        {/* merge node */}
        <circle cx="282" cy="130" r="12" className="fill-primary" />
        <text x="282" y="160" className="fill-muted" fontSize="11" textAnchor="middle">merge</text>
        <path d="M294 130 H330" className="stroke-primary" strokeWidth="2" fill="none" />
        {/* converged */}
        <rect x="330" y="87" width="136" height="86" rx="10" className="fill-primary-soft stroke-primary" strokeWidth="1.5" />
        <text x="346" y="113" className="fill-primary-text" fontSize="13" fontWeight="600">Same state</text>
        <text x="346" y="135" className="fill-primary-text" fontSize="12">price = 470</text>
        <text x="346" y="155" className="fill-primary-text" fontSize="12">stock +1</text>
      </svg>
      <figcaption className="type-caption mt-3 text-muted">
        Illustrative. A later timestamp wins for the price field (last-writer-wins); stock changes are counted, so both adjustments are kept.
      </figcaption>
    </figure>
  )
}

const steps = [
  {
    n: '01',
    title: 'Every device keeps a local replica',
    body: 'Reads and writes go to the copy of the data on the device itself. Screens do not wait for the network, so the app responds the same whether the connection is good, slow or gone.',
  },
  {
    n: '02',
    title: 'Changes are queued, not lost',
    body: 'While offline, each edit is recorded as a pending change with its data type. You can see the queue, retry a change, or discard one that is safe to drop.',
  },
  {
    n: '03',
    title: 'Replicas merge on reconnect',
    body: 'When the connection returns, replicas exchange state and merge it with CRDT rules: last-writer-wins registers for fields such as price, and counters for stock. Order of arrival does not change the result.',
  },
]

const includes = [
  { title: 'Products and categories', body: 'A bilingual (English and Arabic) menu with prices, availability and categories.' },
  { title: 'Stock', body: 'Adjust quantities, set low-stock thresholds and review adjustment history.' },
  { title: 'Synchronization', body: 'Status, activity log, pending queue and a conflict record showing which rule decided each merge.' },
  { title: 'Devices', body: 'A list of simulated devices with their last sync time and pending changes.' },
]

export function LandingPage() {
  useDocumentTitle('Offline-first business workspace')
  const { isAuthenticated, service } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startDemo() {
    setLoading(true)
    setError(null)
    try {
      await service.loginDemo()
      navigate(onboardingStore.get().completed ? '/dashboard' : '/onboarding')
    } catch {
      setError('The demo could not be started. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#main" className="type-label sr-only rounded-control bg-surface px-3 py-2 focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50">
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" aria-label="SyncDesk home" className="rounded-control">
            <Logo />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-2">
            {isAuthenticated ? (
              <ButtonLink to="/dashboard" variant="primary">Open dashboard</ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">Sign in</ButtonLink>
                <Button variant="primary" onClick={startDemo} loading={loading} className="max-sm:px-3">
                  Continue with Demo
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
          <div>
            <p className="type-label text-primary-text">Offline-first synchronization demo</p>
            <h1 className="type-display mt-3 max-w-xl text-fg max-sm:text-[32px] max-sm:leading-10">
              A business workspace that keeps working when the connection doesn&rsquo;t.
            </h1>
            <p className="type-body-lg mt-5 max-w-xl text-fg2">
              SyncDesk is a menu and stock manager built on a lightweight CRDT-based synchronization layer. Take orders, edit prices and adjust stock with no signal; everything merges when the network is back.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {isAuthenticated ? (
                <ButtonLink to="/dashboard" variant="primary" size="lg" icon={<ArrowRight aria-hidden className="size-4 rtl:rotate-180" />}>
                  Open dashboard
                </ButtonLink>
              ) : (
                <>
                  <Button variant="primary" size="lg" onClick={startDemo} loading={loading}>
                    Continue with Demo
                  </Button>
                  <ButtonLink to="/login" size="lg">Sign in</ButtonLink>
                </>
              )}
            </div>
            {error ? <Banner tone="error" className="mt-4 max-w-md">{error}</Banner> : null}
            <p className="type-body-sm mt-4 max-w-md text-muted">
              No account is needed. The demo opens a local workspace with sample data stored in this browser.
            </p>
          </div>
          <ReplicaSchematic />
        </section>

        <section aria-labelledby="how" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
            <h2 id="how" className="type-h1 max-w-lg">How it works</h2>
            <p className="type-body-lg mt-2 max-w-xl text-fg2">Three ideas, in the order they happen.</p>
            <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
              {steps.map((s) => (
                <li key={s.n} className="border-t border-line-strong pt-4">
                  <span className="tabular font-mono text-[13px] text-muted">{s.n}</span>
                  <h3 className="type-h2 mt-2">{s.title}</h3>
                  <p className="type-body mt-2 text-fg2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="includes" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
          <div className="grid gap-10 md:grid-cols-[1fr_2fr] md:gap-16">
            <div>
              <h2 id="includes" className="type-h1">What the demo includes</h2>
              <p className="type-body mt-2 text-fg2">A small restaurant back office, used to make the synchronization behavior visible.</p>
            </div>
            <dl className="divide-y divide-line border-y border-line">
              {includes.map((i) => (
                <div key={i.title} className="grid gap-1 py-4 sm:grid-cols-[200px_1fr] sm:gap-6">
                  <dt className="type-h3">{i.title}</dt>
                  <dd className="type-body text-fg2">{i.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="research" className="mx-auto max-w-6xl px-4 pb-14 sm:px-6 md:pb-20">
          <Banner tone="info" title="Research demonstrator">
            <span id="research" className="sr-only">Research demonstrator note</span>
            This application is the practical part of a Master&rsquo;s graduation project. The sync transport between devices is simulated inside the browser, and sign-in is demo authentication only. It is not a production product and does not connect to real devices or a server.
          </Banner>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo className="[&_span:last-child]:text-[15px]" />
          <p className="type-body-sm text-muted">Graduation project demonstrator. Data stays in this browser.</p>
        </div>
      </footer>
    </div>
  )
}
