import { ReplicaRuntime } from '@/backend/crdt/replica'
import { createStateMessage, encodeSyncMessage, type StateSyncMessage } from '@/backend/sync/protocol'
import type { PendingChange } from '@/domain/sync'

export interface BackendHealth {
  status: 'ok'
  apiVersion: string
}

export interface BackendReplicaResponse {
  replicaId: string
  snapshot: unknown
  persisted: boolean
  updatedAt: number | null
}

export interface BackendSyncResponse {
  applied: boolean
  acknowledgement: {
    status: 'applied' | 'duplicate'
    messageId: string
  }
  replicaId: string
  snapshot: unknown
  persistedAt: number
}

export class BackendApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BackendApiError'
  }
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

export class BackendApiClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    if (!baseUrl.trim()) throw new Error('Backend URL is required')
    this.baseUrl = normalizeBaseUrl(baseUrl.trim())
  }

  async health(): Promise<BackendHealth> {
    return this.request<BackendHealth>('/health')
  }

  async getReplica(): Promise<BackendReplicaResponse> {
    return this.request<BackendReplicaResponse>('/v1/replica')
  }

  async syncChanges(
    replicaId: string,
    changes: readonly PendingChange[],
  ): Promise<BackendSyncResponse> {
    const replica = new ReplicaRuntime<string>(replicaId)
    for (const change of changes) {
      replica.add(`${change.kind}:${change.entityId}:${change.id}`)
      replica.incrementCounter()
    }

    const messageId = `${replicaId}:${changes.map((change) => change.id).join(',')}`
    const message = createStateMessage(replicaId, messageId, replica.snapshot())
    return this.request<BackendSyncResponse>('/v1/sync/messages', {
      method: 'POST',
      body: JSON.stringify(message),
      headers: { 'content-type': 'application/json' },
    })
  }

  encodeChanges(replicaId: string, changes: readonly PendingChange[]): Uint8Array {
    const replica = new ReplicaRuntime<string>(replicaId)
    for (const change of changes) replica.add(`${change.kind}:${change.entityId}:${change.id}`)
    const message: StateSyncMessage<string> = createStateMessage(
      replicaId,
      `${replicaId}:${changes.map((change) => change.id).join(',')}`,
      replica.snapshot(),
    )
    return encodeSyncMessage(message)
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, options)
    } catch {
      throw new BackendApiError(0, 'backend_unavailable', 'The backend is unavailable.')
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new BackendApiError(response.status, 'invalid_backend_response', 'The backend returned an invalid response.')
    }

    if (!response.ok) {
      const error = body as { error?: { code?: string; message?: string } }
      throw new BackendApiError(
        response.status,
        error.error?.code ?? 'backend_error',
        error.error?.message ?? 'The backend request failed.',
      )
    }

    return body as T
  }
}
