import type { ReplicaSnapshot } from "../crdt/replica"

export const SYNC_PROTOCOL_VERSION = 1
export const MAX_SYNC_MESSAGE_BYTES = 1024 * 1024

export interface StateSyncMessage<T extends string> {
  type: "state"

  protocol: "syncdesk-state"

  version: 1

  messageId: string

  fromReplicaId: string

  snapshot: ReplicaSnapshot<T>
}

export interface SyncAckMessage {
  type: "ack"
  protocol: "syncdesk-state"
  version: 1
  messageId: string
  fromReplicaId: string
  status: "applied" | "duplicate"
}

export type SyncMessage<T extends string> = StateSyncMessage<T> | SyncAckMessage

export const createStateMessage = <T extends string,>(
  fromReplicaId: string,
  messageId: string,
  snapshot: ReplicaSnapshot<T>,
): StateSyncMessage<T> => ({
  type: "state",
  protocol: "syncdesk-state",

  version: SYNC_PROTOCOL_VERSION,

  messageId,

  fromReplicaId,

  snapshot,
})

export const createAckMessage = (
  fromReplicaId: string,
  messageId: string,
  status: SyncAckMessage["status"],
): SyncAckMessage => ({
  type: "ack",
  protocol: "syncdesk-state",
  version: SYNC_PROTOCOL_VERSION,
  messageId,
  fromReplicaId,
  status,
})

const encodedSize = (message: unknown): number =>
  new TextEncoder().encode(JSON.stringify(message)).byteLength

export const encodeSyncMessage = <T extends string,>(
  message: SyncMessage<T>,
): Uint8Array => {
  const encoded = new TextEncoder().encode(JSON.stringify(message))
  if (encoded.byteLength > MAX_SYNC_MESSAGE_BYTES)
    throw new Error("Sync message exceeds size limit")
  return encoded
}

export const decodeSyncMessage = <T extends string,>(
  encoded: Uint8Array,
): unknown => {
  if (encoded.byteLength > MAX_SYNC_MESSAGE_BYTES)
    throw new Error("Sync message exceeds size limit")
  try {
    return JSON.parse(new TextDecoder().decode(encoded)) as unknown
  } catch (error) {
    throw new Error(
      `Invalid encoded sync message: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export const validateStateMessage = <T extends string,>(
  message: unknown,
): StateSyncMessage<T> => {
  if (!message || typeof message !== "object")
    throw new Error("Sync message must be an object")

  const candidate = message as Partial<StateSyncMessage<T>>

  if (
    candidate.type !== "state" ||
    candidate.protocol !== "syncdesk-state" ||
    candidate.version !== SYNC_PROTOCOL_VERSION ||
    typeof candidate.messageId !== "string" ||
    !candidate.messageId ||
    typeof candidate.fromReplicaId !== "string" ||
    !candidate.fromReplicaId ||
    !candidate.snapshot ||
    candidate.snapshot.replicaId !== candidate.fromReplicaId
  ) {
    throw new Error("Invalid or unsupported sync message")
  }
  if (encodedSize(message) > MAX_SYNC_MESSAGE_BYTES)
    throw new Error("Sync message exceeds size limit")

  return candidate as StateSyncMessage<T>
}
