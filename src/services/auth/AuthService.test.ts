import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '@/lib/storage'
import { AuthError, DEMO_EMAIL, DEMO_PASSWORD, LocalAuthService } from './AuthService'

function make(online = true) {
  const persistent = createMemoryStorage()
  const session = createMemoryStorage()
  const auth = new LocalAuthService({ persistent, session, isOnline: () => online, latencyMs: 0 })
  return { auth, persistent, session }
}

describe('LocalAuthService', () => {
  it('signs in with the demo credentials and signs out', async () => {
    const { auth } = make()
    expect(auth.isAuthenticated()).toBe(false)
    const user = await auth.login(DEMO_EMAIL, DEMO_PASSWORD, { remember: true })
    expect(user.email).toBe(DEMO_EMAIL)
    expect(auth.isAuthenticated()).toBe(true)
    await auth.logout()
    expect(auth.isAuthenticated()).toBe(false)
  })

  it('rejects invalid credentials without creating a session', async () => {
    const { auth } = make()
    await expect(auth.login(DEMO_EMAIL, 'wrong', { remember: false })).rejects.toMatchObject({ code: 'invalid-credentials' })
    expect(auth.isAuthenticated()).toBe(false)
  })

  it('never stores the plaintext password', async () => {
    const { auth, persistent, session } = make()
    await auth.login(DEMO_EMAIL, DEMO_PASSWORD, { remember: true })
    const dump = JSON.stringify([persistent, session, ...Object.keys(persistent)].map(String))
    for (const store of [persistent, session]) {
      for (const k of ['syncdesk.credentials.v1', 'syncdesk.session.v1']) {
        expect(store.getItem(k) ?? '').not.toContain(DEMO_PASSWORD)
      }
    }
    expect(dump).not.toContain(DEMO_PASSWORD)
  })

  it('restores a remembered session in a new service instance', async () => {
    const { auth, persistent, session } = make()
    await auth.login(DEMO_EMAIL, DEMO_PASSWORD, { remember: true })
    const again = new LocalAuthService({ persistent, session: createMemoryStorage(), isOnline: () => true, latencyMs: 0 })
    expect(again.isAuthenticated()).toBe(true)
  })

  it('needs a connection to request a password reset', async () => {
    const { auth } = make(false)
    const err = await auth.requestPasswordReset(DEMO_EMAIL).catch((e) => e)
    expect(err).toBeInstanceOf(AuthError)
    expect(err.code).toBe('offline')
  })
})
