import { ReplicaRuntime } from "../crdt/replica"

import {
  createAckMessage,
  encodeSyncMessage,
  validateStateMessage,
  type StateSyncMessage,
  type SyncAckMessage,
} from "./protocol"

export interface RetryPolicy {
  maxRetries: number
}

export class ReliableSyncSender<T extends string> {
  private readonly pending = new Map<string, {
    message: StateSyncMessage<T>
    retries: number
  }>()

  constructor(private readonly policy: RetryPolicy = { maxRetries: 3 }) {
    if (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0)
      throw new Error("Retry limit must be a non-negative integer")
  }

  track(message: StateSyncMessage<T>): Uint8Array {
    this.pending.set(message.messageId, { message, retries: 0 })
    return encodeSyncMessage(message)
  }

  acknowledge(acknowledgement: SyncAckMessage): boolean {
    return this.pending.delete(acknowledgement.messageId)
  }

  retry(messageId: string): Uint8Array | undefined {
    const pending = this.pending.get(messageId)
    if (!pending) return undefined
    if (pending.retries >= this.policy.maxRetries) {
      this.pending.delete(messageId)
      throw new Error(`Retry limit exceeded for message ${messageId}`)
    }
    pending.retries += 1
    return encodeSyncMessage(pending.message)
  }

  pendingMessageIds(): string[] {
    return [...this.pending.keys()].sort()
  }
}

export interface ReceiveResult<T extends string> {
  acknowledgement: SyncAckMessage

  applied: boolean

  replica: ReplicaRuntime<T>
}

export class ReliableSyncEndpoint<T extends string> {
  private readonly appliedMessageIds = new Set<string>()

  constructor(readonly replica: ReplicaRuntime<T>) {}

  encode(message: StateSyncMessage<T>): Uint8Array {
    return encodeSyncMessage(message)
  }

  receive(message: unknown | Uint8Array): ReceiveResult<T> {
    if (message instanceof Uint8Array) {
      message = (JSON.parse(new TextDecoder().decode(message)) as unknown)
    }
    const stateMessage = validateStateMessage<T>(message)

    if (this.appliedMessageIds.has(stateMessage.messageId)) {
      return {
        acknowledgement: createAckMessage(
          this.replica.replicaId,

          stateMessage.messageId,

          "duplicate",
        ),

        applied: false,

        replica: this.replica,
      }
    }

    this.replica.merge(ReplicaRuntime.fromJSON(stateMessage.snapshot))

    this.appliedMessageIds.add(stateMessage.messageId)

    return {
      acknowledgement: createAckMessage(
        this.replica.replicaId,

        stateMessage.messageId,

        "applied",
      ),

      applied: true,

      replica: this.replica,
    }
  }

  restoreAppliedMessageIds(messageIds: readonly string[]): void {
    for (const messageId of messageIds) {
      if (!messageId) throw new Error("Invalid applied message ID")

      this.appliedMessageIds.add(messageId)
    }
  }

  appliedMessageIdSnapshot(): string[] {
    return [...this.appliedMessageIds].sort()
  }
}
