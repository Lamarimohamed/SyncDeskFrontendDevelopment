import type { KeyValueStorage } from './storage'

export interface InstallationIdentity {
  deviceId: string
  replicaId: string
}

export type IdentityRandomUUID = () => string

export class InstallationIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallationIdentityError'
  }
}

const IDENTITY_KEY = 'syncdesk.installation.v1'

const isIdentity = (value: unknown): value is InstallationIdentity =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as { deviceId?: unknown }).deviceId === 'string' &&
  (value as { deviceId: string }).deviceId.length > 0 &&
  typeof (value as { replicaId?: unknown }).replicaId === 'string' &&
  (value as { replicaId: string }).replicaId.length > 0 &&
  (value as { deviceId: string }).deviceId !== (value as { replicaId: string }).replicaId

const createUuid = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return globalThis.crypto.randomUUID()
  throw new InstallationIdentityError(
    'This browser does not provide a cryptographically secure identity generator.',
  )
}

export const loadOrCreateInstallationIdentity = (
  storage: KeyValueStorage,
  randomUUID: IdentityRandomUUID = createUuid,
  legacyReplicaId?: string,
): InstallationIdentity => {
  let raw: string | null
  try {
    raw = storage.getItem(IDENTITY_KEY)
  } catch (error) {
    throw new InstallationIdentityError(
      'Persistent browser storage is unavailable. Enable site storage and reload before continuing.',
    )
  }

  if (raw !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new InstallationIdentityError(
        'The persisted browser installation identity is corrupt. Clear this site data and reload.',
      )
    }
    if (!isIdentity(parsed))
      throw new InstallationIdentityError(
        'The persisted browser installation identity is invalid. Clear this site data and reload.',
      )
    return parsed
  }

  const identity = {
    deviceId: `device-${randomUUID()}`,
    replicaId: legacyReplicaId || `replica-${randomUUID()}`,
  }
  if (!identity.deviceId || !identity.replicaId || identity.deviceId === identity.replicaId)
    throw new InstallationIdentityError('A secure browser installation identity could not be generated.')

  try {
    storage.setItem(IDENTITY_KEY, JSON.stringify(identity))
    if (storage.getItem(IDENTITY_KEY) !== JSON.stringify(identity))
      throw new Error('Identity persistence verification failed.')
  } catch {
    throw new InstallationIdentityError(
      'The browser installation identity could not be persisted. Enable site storage and reload before continuing.',
    )
  }
  return identity
}

export const installationIdentityStorageKey = IDENTITY_KEY
