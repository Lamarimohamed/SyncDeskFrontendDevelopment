import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/hooks/useAuth'
import { useSyncSnapshot } from '@/hooks/useSync'
import { AuthError, DEMO_RESET_TOKEN_EXPIRED } from '@/services/auth/AuthService'

const MIN_LENGTH = 8

function passwordProblem(p: string): string | undefined {
  if (!p) return 'Enter a new password.'
  if (p.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'Include at least one letter and one number.'
  return undefined
}

export function ResetPasswordPage() {
  const { service } = useAuth()
  const offline = useSyncSnapshot().connectivity === 'offline'
  const [params] = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [tokenInvalid, setTokenInvalid] = useState(!token || token === DEMO_RESET_TOKEN_EXPIRED)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const footer = <Link to="/login" className="font-medium text-primary-text hover:underline">Back to sign in</Link>

  if (done) {
    return (
      <AuthLayout title="Password updated" description="Your password has been changed. Sign in with the new password to continue.">
        <ButtonLink to="/login" variant="primary" className="w-full">Go to sign in</ButtonLink>
      </AuthLayout>
    )
  }

  if (tokenInvalid) {
    return (
      <AuthLayout
        title="This reset link is not valid"
        description={
          token
            ? 'The link has expired or was already used. Reset links only work for a short time.'
            : 'The link is missing its reset token. Open the link from your email again, or request a new one.'
        }
        footer={footer}
      >
        <ButtonLink to="/forgot-password" variant="primary" className="w-full">Request a new link</ButtonLink>
      </AuthLayout>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const next = {
      password: passwordProblem(password),
      confirm: !confirm ? 'Confirm your new password.' : confirm !== password ? 'The passwords do not match.' : undefined,
    }
    setErrors(next)
    if (next.password || next.confirm) return
    setLoading(true)
    try {
      await service.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      if (err instanceof AuthError && err.code === 'invalid-token') setTokenInvalid(true)
      else if (err instanceof AuthError && err.code === 'weak-password') setErrors({ password: err.message })
      else if (err instanceof AuthError && err.code === 'offline')
        setFormError('You are offline. Reconnect to change your password; nothing was saved.')
      else setFormError('The password could not be changed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="Use at least 8 characters with a letter and a number."
      banner={
        offline ? (
          <Banner tone="offline" title="You are offline">
            Changing your password needs a connection.
          </Banner>
        ) : undefined
      }
      footer={footer}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        <Field label="New password" error={errors.password}>
          <Input type="password" name="new-password" autoComplete="new-password" autoFocus value={password} disabled={loading} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <Input type="password" name="confirm-password" autoComplete="new-password" value={confirm} disabled={loading} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={offline}>
          Update password
        </Button>
        {offline ? <p className="type-body-sm text-muted">Disabled while offline.</p> : null}
      </form>
      <p className="type-body-sm mt-6 rounded-control bg-subtle px-3 py-2 text-muted">
        Demo authentication: the new password is stored only in this browser.
      </p>
    </AuthLayout>
  )
}
