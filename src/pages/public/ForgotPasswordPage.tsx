import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/hooks/useAuth'
import { useSyncSnapshot } from '@/hooks/useSync'
import { AuthError } from '@/services/auth/AuthService'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ForgotPasswordPage() {
  const { service } = useAuth()
  const offline = useSyncSnapshot().connectivity === 'offline'
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const value = email.trim()
    if (!value) return setFieldError('Enter your email address.')
    if (!EMAIL_RE.test(value)) return setFieldError('Enter a valid email address, like name@example.com.')
    setFieldError(undefined)
    setLoading(true)
    try {
      await service.requestPasswordReset(value)
      setSent(true)
    } catch (err) {
      setFormError(
        err instanceof AuthError && err.code === 'offline'
          ? 'You are offline. Password reset needs a connection. Reconnect and try again.'
          : 'The request could not be completed. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const note = (
    <p className="type-body-sm mt-6 rounded-control bg-subtle px-3 py-2 text-muted">
      Demo authentication: no email is actually sent.
    </p>
  )

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        description={`If an account exists for ${email.trim()}, a reset link has been sent. The message can take a few minutes to arrive.`}
        footer={<Link to="/login" className="font-medium text-primary-text hover:underline">Back to sign in</Link>}
      >
        <div className="flex flex-col gap-3">
          <Button onClick={() => setSent(false)}>Use a different email</Button>
        </div>
        {note}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email you use for SyncDesk and we will send a link to choose a new password."
      banner={
        offline ? (
          <Banner tone="offline" title="You are offline">
            Password reset needs a connection. The rest of the app keeps working offline.
          </Banner>
        ) : undefined
      }
      footer={<Link to="/login" className="font-medium text-primary-text hover:underline">Back to sign in</Link>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        <Field label="Email" error={fieldError}>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            value={email}
            disabled={loading}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={offline}>
          Send reset link
        </Button>
        {offline ? <p className="type-body-sm text-muted">Disabled while offline.</p> : null}
      </form>
      {note}
      <ButtonLink to="/login" variant="ghost" className="mt-2 w-full sm:hidden">Cancel</ButtonLink>
    </AuthLayout>
  )
}
