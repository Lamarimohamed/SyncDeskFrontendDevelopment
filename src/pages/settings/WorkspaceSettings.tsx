import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useStore } from '@/lib/store'
import { syncService } from '@/services/container'
import { workspaceStore } from '@/state/workspace'
import { SettingsSection } from './SettingsSection'

export function WorkspaceSettings() {
  useDocumentTitle('Workspace settings')
  const ws = useStore(workspaceStore)
  const toast = useToast()
  const [name, setName] = useState(ws.name)
  const [deviceName, setDeviceName] = useState(ws.deviceName)
  const [threshold, setThreshold] = useState(String(ws.defaultLowStockThreshold))
  const [errors, setErrors] = useState<{ name?: string; deviceName?: string; threshold?: string }>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const dirty = name.trim() !== ws.name || deviceName.trim() !== ws.deviceName || threshold !== String(ws.defaultLowStockThreshold)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = 'Give the workspace a name.'
    if (!deviceName.trim()) next.deviceName = 'Give this device a name.'
    const t = Number(threshold)
    if (threshold.trim() === '' || !Number.isInteger(t) || t < 0) next.threshold = 'Enter a whole number, 0 or more.'
    setErrors(next)
    if (Object.keys(next).length) return
    workspaceStore.set({ name: name.trim(), deviceName: deviceName.trim(), defaultLowStockThreshold: t })
    setName(name.trim())
    setDeviceName(deviceName.trim())
    toast.show({ title: 'Workspace saved', tone: 'success' })
  }

  async function resetData() {
    setResetting(true)
    setResetError(null)
    try {
      await Promise.resolve(syncService.resetDemoData())
      setConfirmOpen(false)
      toast.show({ title: 'Demo data reset', description: 'Products, stock and the pending queue are back to the sample data.', tone: 'success' })
    } catch {
      setResetError('The demo data could not be reset. Nothing was changed.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div>
      <SettingsSection title="Workspace" description="Names and defaults used across the app.">
        <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
          <Field label="Workspace name" error={errors.name}>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Device name" error={errors.deviceName} helper="Shown in the device list as this device.">
            <Input value={deviceName} maxLength={40} onChange={(e) => setDeviceName(e.target.value)} />
          </Field>
          <Field label="Currency" helper="The demo supports Algerian dinar (DA) only.">
            <Input value={ws.currency} readOnly disabled />
          </Field>
          <Field
            label="Default low-stock threshold"
            error={errors.threshold}
            helper="Applied to new products. Existing products keep their own threshold."
          >
            <Input type="number" inputMode="numeric" min={0} step={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" disabled={!dirty}>Save changes</Button>
        </form>
      </SettingsSection>
      <SettingsSection
        title="Demo data"
        description="Restore the sample products, categories, stock and activity, and clear the pending changes queue. Your settings are kept."
      >
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>Reset demo data</Button>
      </SettingsSection>
      <ConfirmDialog
        open={confirmOpen}
        title="Reset demo data?"
        description="Edits you made to products, categories and stock will be replaced by the original sample data."
        confirmLabel="Reset data"
        loading={resetting}
        error={resetError}
        onConfirm={resetData}
        onCancel={() => {
          setConfirmOpen(false)
          setResetError(null)
        }}
      >
        <p>Pending changes that have not synchronized will be discarded. This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  )
}
