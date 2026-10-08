import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/** Filter state kept in the URL so it survives refresh and navigation. */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams()
  const values = Object.fromEntries(
    (Object.keys(defaults) as K[]).map((k) => [k, params.get(k) ?? defaults[k]]),
  ) as Record<K, string>

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch) as [K, string][]) {
            if (v === defaults[k] || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  )

  const clear = useCallback(() => setParams({}, { replace: true }), [setParams])
  return { values, set, clear, isDefault: (Object.keys(defaults) as K[]).every((k) => values[k] === defaults[k]) }
}
