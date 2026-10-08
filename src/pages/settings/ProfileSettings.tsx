import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { SettingsSection } from './SettingsSection'

export function ProfileSettings() {
  useDocumentTitle('Profile settings')
  const { user, service } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  if (!user) return null
  const dirty = name.trim() !== user.name

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const trimmed = name.trim()
    if (!trimmed) return setError('Enter your name.')
    setError(undefined)
    setSaving(true)
    try {
      await service.updateProfile({ name: trimmed, email: user.email })
      toast.show({ title: 'Profile saved', tone: 'success' })
    } catch {
      toast.show({ title: 'Profile not saved', description: 'Something went wrong. Try again.', tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function signOut() {
    setSigningOut(true)
    await service.logout()
    navigate('/login')
  }

  return (
    <div>
      <SettingsSection title="Profile" description="How you appear in the workspace.">
        <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
          <Field label="Name" error={error}>
            <Input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" helper="Email cannot be changed in the demo.">
            <Input value={user.email} readOnly disabled />
          </Field>
          <div>
            <p className="type-label text-fg">Role</p>
            <p className="mt-1.5"><Badge tone="primary"><span className="capitalize">{user.role}</span></Badge></p>
          </div>
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save changes</Button>
        </form>
      </SettingsSection>
      <SettingsSection title="Session" description="Signing out ends this session. Local data and queued changes stay on this device.">
        <Button onClick={signOut} loading={signingOut}>Sign out</Button>
      </SettingsSection>
    </div>
  )
}
