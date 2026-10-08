import { useSyncExternalStore } from 'react'
import { browserStorage, readJson, writeJson, type KeyValueStorage } from './storage'

export interface PersistedStore<T> {
  get(): T
  set(patch: Partial<T>): void
  reset(): void
  subscribe(listener: () => void): () => void
}

export function createPersistedStore<T extends object>(
  key: string,
  defaults: T,
  storage: KeyValueStorage = browserStorage(),
): PersistedStore<T> {
  let state: T = { ...defaults, ...readJson<Partial<T>>(storage, key, {}) }
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch }
      writeJson(storage, key, state)
      emit()
    },
    reset() {
      state = { ...defaults }
      storage.removeItem(key)
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useStore<T extends object>(store: PersistedStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
