import { useCallback, useEffect, useRef, useState } from 'react'
import { repository } from '@/services/container'

export type QueryStatus = 'loading' | 'success' | 'error'

export interface QueryState<T> {
  status: QueryStatus
  data: T | undefined
  error: Error | null
  reload: () => void
}

/**
 * Loads data through the repository. Shows the loading state once, then
 * refreshes silently whenever the local replica changes.
 */
export function useRepositoryQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): QueryState<T> {
  const [state, setState] = useState<{ status: QueryStatus; data: T | undefined; error: Error | null }>({
    status: 'loading',
    data: undefined,
    error: null,
  })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seq = useRef(0)

  const run = useCallback((silent: boolean) => {
    const id = ++seq.current
    if (!silent) setState(() => ({ status: 'loading', data: undefined, error: null }))
    fetcherRef.current().then(
      (data) => {
        if (id === seq.current) setState({ status: 'success', data, error: null })
      },
      (error: unknown) => {
        if (id === seq.current) setState({ status: 'error', data: undefined, error: error instanceof Error ? error : new Error(String(error)) })
      },
    )
  }, [])

  useEffect(() => {
    run(false)
    const unsubscribe = repository.subscribe(() => run(true))
    return () => {
      seq.current++
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps])

  const reload = useCallback(() => run(false), [run])
  return { ...state, reload }
}
