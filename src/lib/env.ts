const meta = import.meta.env

export const env = {
  isDev: Boolean(meta.DEV),
  isTest: meta.MODE === 'test',
  /** Demo mode exposes simulation controls and demo authentication. */
  demoMode: meta.VITE_DEMO_MODE !== 'false',
  backendUrl: meta.VITE_BACKEND_URL?.trim() || null,
} as const
