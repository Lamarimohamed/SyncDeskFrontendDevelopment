import type { Role, User } from '@/domain/types'
import { logger } from '@/lib/logger'
import { readJson, writeJson, type KeyValueStorage } from '@/lib/storage'

export type AuthErrorCode = 'invalid-credentials' | 'offline' | 'invalid-token' | 'weak-password'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface LoginOptions {
  remember: boolean
}

export interface AuthService {
  login(email: string, password: string, options: LoginOptions): Promise<User>
  loginDemo(): Promise<User>
  logout(): Promise<void>
  getCurrentUser(): User | null
  isAuthenticated(): boolean
  hasRole(...roles: Role[]): boolean
  updateProfile(patch: Pick<User, 'name' | 'email'>): Promise<User>
  requestPasswordReset(email: string): Promise<void>
  resetPassword(token: string | null, newPassword: string): Promise<void>
  subscribe(listener: () => void): () => void
}

export const DEMO_EMAIL = 'manager@demo.syncdesk.app'
export const DEMO_PASSWORD = 'demo-sync-2026'
export const DEMO_RESET_TOKEN_EXPIRED = 'expired'

const DEMO_USER: User = {
  id: 'u-demo',
  name: 'Demo Manager',
  email: DEMO_EMAIL,
  role: 'manager',
  workspaceName: 'Demo Workspace',
}

// SHA-256 of "syncdesk-demo:" + demo password. Demo-only; a real provider replaces this service.
const DEMO_PASSWORD_HASH = '1d61ba2944f373e8f402fdc48183b7fef01798cbd937ee6146566d9b37539432'

const SESSION_KEY = 'syncdesk.session.v1'
const PROFILE_KEY = 'syncdesk.profile.v1'
const CREDENTIAL_KEY = 'syncdesk.credential.v1'

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`syncdesk-demo:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface LocalAuthDeps {
  persistent: KeyValueStorage
  session: KeyValueStorage
  isOnline: () => boolean
  latencyMs?: number
}

/** Local demo authentication. Not production authentication. */
export class LocalAuthService implements AuthService {
  private user: User | null
  private listeners = new Set<() => void>()
  private readonly latency: number

  constructor(private readonly deps: LocalAuthDeps) {
    this.latency = deps.latencyMs ?? 500
    this.user = this.restore()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.user

  getCurrentUser = () => this.user
  isAuthenticated = () => this.user !== null
  hasRole = (...roles: Role[]) => this.user !== null && roles.includes(this.user.role)

  async login(email: string, password: string, options: LoginOptions): Promise<User> {
    await this.wait()
    const expected = readJson<Record<string, string>>(this.deps.persistent, CREDENTIAL_KEY, {})[DEMO_EMAIL] ?? DEMO_PASSWORD_HASH
    const matches = email.trim().toLowerCase() === DEMO_EMAIL && (await hashPassword(password)) === expected
    if (!matches) {
      logger.warn('AUTH', 'Login rejected')
      throw new AuthError('invalid-credentials', 'The email or password is incorrect.')
    }
    return this.startSession(options.remember)
  }

  async loginDemo(): Promise<User> {
    await this.wait(300)
    return this.startSession(true)
  }

  async logout(): Promise<void> {
    this.deps.persistent.removeItem(SESSION_KEY)
    this.deps.session.removeItem(SESSION_KEY)
    this.user = null
    logger.debug('AUTH', 'Signed out')
    this.emit()
  }

  async updateProfile(patch: Pick<User, 'name' | 'email'>): Promise<User> {
    if (!this.user) throw new AuthError('invalid-token', 'You need to sign in first.')
    await this.wait(400)
    this.user = { ...this.user, ...patch }
    writeJson(this.deps.persistent, PROFILE_KEY, this.user)
    this.emit()
    return this.user
  }

  async requestPasswordReset(email: string): Promise<void> {
    if (!this.deps.isOnline()) throw new AuthError('offline', 'Password reset needs a connection.')
    await this.wait(700)
    logger.debug('AUTH', 'Password reset requested', { email })
  }

  async resetPassword(token: string | null, newPassword: string): Promise<void> {
    if (!this.deps.isOnline()) throw new AuthError('offline', 'Password reset needs a connection.')
    await this.wait(700)
    if (token === DEMO_RESET_TOKEN_EXPIRED) throw new AuthError('invalid-token', 'This reset link has expired.')
    const hash = await hashPassword(newPassword)
    const stored = readJson<Record<string, string>>(this.deps.persistent, CREDENTIAL_KEY, {})
    writeJson(this.deps.persistent, CREDENTIAL_KEY, { ...stored, [DEMO_EMAIL]: hash })
  }

  private startSession(remember: boolean): User {
    const profile = readJson<User | null>(this.deps.persistent, PROFILE_KEY, null)
    this.user = profile ?? DEMO_USER
    const target = remember ? this.deps.persistent : this.deps.session
    target.setItem(SESSION_KEY, this.user.id)
    logger.debug('AUTH', 'Signed in', { remember })
    this.emit()
    return this.user
  }

  private restore(): User | null {
    const id = this.deps.persistent.getItem(SESSION_KEY) ?? this.deps.session.getItem(SESSION_KEY)
    if (!id) return null
    return readJson<User | null>(this.deps.persistent, PROFILE_KEY, null) ?? DEMO_USER
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }

  private wait(ms = this.latency): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
  }
}
