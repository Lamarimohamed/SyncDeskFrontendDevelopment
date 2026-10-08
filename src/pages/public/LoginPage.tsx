import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { Eye, EyeOff } from 'lucide-react'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { IconButton } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { useSyncSnapshot } from '@/hooks/useSync'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/services/auth/AuthService'
import { onboardingStore } from '@/state/workspace'
import { env } from '@/lib/env'

function destination(next: string | null) {
  if (!onboardingStore.get().completed) return '/onboarding'
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
}

export function LoginPage() {
  const { isAuthenticated, service } = useAuth()
  const connectivity = useSyncSnapshot().connectivity
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null)

  if (isAuthenticated && !busy) return <Navigate to={destination(next)} replace />

  const validate = () => {
    const e: typeof errors = {}
    if (!email.trim()) e.email = 'Enter your email address.'
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter a valid email address, like name@example.com.'
    if (!password) e.password = 'Enter your password.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setFormError(null)
    if (!validate()) return
    setBusy('login')
    try {
      await service.login(email, password, { remember })
      navigate(destination(next), { replace: true })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign in failed. Try again.')
      setBusy(null)
    }
  }

  const demo = async () => {
    setFormError(null)
    setBusy('demo')
    try {
      await service.loginDemo()
      navigate(destination(next), { replace: true })
    } catch {
      setFormError('Could not start the demo session.')
      setBusy(null)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Sign in to your workspace. Your data is stored on this device first."
      banner={
        connectivity === 'offline' ? (
          <Banner tone="offline" title="You are offline">
            Signing in with an existing local session works offline. Password reset needs a connection.
          </Banner>
        ) : null
      }
      footer={
        <>
          New here? <Link to="/" className="text-primary-text underline-offset-2 hover:underline">Read what SyncDesk is</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError ? (
          <div role="alert">
            <Banner tone="error" title="Could not sign in">
              {formError}
            </Banner>
          </div>
        ) : null}
        <Field label="Email" error={errors.email}>
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Password" error={errors.password}>
          <Input
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            end={
              <IconButton label={show ? 'Hide password' : 'Show password'} size="sm" aria-pressed={show} onClick={() => setShow((v) => !v)}>
                {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
              </IconButton>
            }
          />
        </Field>
        <div className="flex items-center justify-between gap-4">
          <Checkbox label="Remember me on this device" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <Link to="/forgot-password" className="type-body-sm shrink-0 text-primary-text underline-offset-2 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={busy === 'login'} disabled={busy !== null}>
          Sign in
        </Button>
      </form>

      {env.demoMode ? (
        <div className="mt-6 border-t border-line pt-6">
          <p className="type-label text-fg">Demo workspace</p>
          <p className="type-body-sm mt-1 text-fg2">
            Demo sign-in is local to this browser and is not production authentication. Use the sample account or skip the form.
          </p>
          <dl className="type-body-sm mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-input bg-subtle px-3 py-2">
            <dt className="text-muted">Email</dt>
            <dd className="font-mono text-fg">{DEMO_EMAIL}</dd>
            <dt className="text-muted">Password</dt>
            <dd className="font-mono text-fg">{DEMO_PASSWORD}</dd>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              disabled={busy !== null}
              onClick={() => {
                setEmail(DEMO_EMAIL)
                setPassword(DEMO_PASSWORD)
                setErrors({})
              }}
            >
              Fill sample account
            </Button>
            <Button className="flex-1" variant="secondary" loading={busy === 'demo'} disabled={busy !== null} onClick={demo}>
              Continue with Demo
            </Button>
          </div>
        </div>
      ) : null}
    </AuthLayout>
  )
}
