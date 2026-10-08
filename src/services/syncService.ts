import type { SyncSnapshot } from '@/domain/sync'
import type { Repository } from '@/repositories/Repository'
import type { MockRepository } from '@/repositories/MockRepository'
import { preferencesStore } from '@/state/preferences'
import type { SyncEngine } from './sync/SyncEngine'

const RETRY_DELAY_MS = 5000
const DEMO_PRODUCT_ID = 'p-coffee'

/** Application-facing synchronization API. UI code never touches the engine directly. */
export class SyncService {
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly engine: SyncEngine,
    private readonly repository: Repository,
    private readonly devRepository: Pick<MockRepository, 'setFailReads' | 'isFailingReads' | 'resetDemoData'>,
  ) {
    engine.subscribe(() => this.maybeAutoRetry())
  }

  getSnapshot = (): SyncSnapshot => this.engine.getSnapshot()
  subscribe = (listener: () => void) => this.engine.subscribe(listener)

  get replicaId() {
    return this.engine.replicaId
  }

  syncNow = () => this.engine.syncNow()
  goOffline = () => this.engine.goOffline()
  goOnline = () => this.engine.goOnline()
  reconnect = () => this.engine.reconnect()
  retryChange = (id: string) => this.engine.retryChange(id)
  clearPending = () => this.engine.clearPending()
  discardChange = (id: string) => this.repository.discardPendingChange(id)
  simulateSyncError = () => {
    this.engine.setFailNextSync(true)
    this.engine.syncNow()
  }

  /** Dev: a remote device sets the demo product's price while this device has its own pending edit. */
  async simulateConflict(): Promise<void> {
    const product = await this.repository.getProduct(DEMO_PRODUCT_ID)
    const pendingPrice = this.engine
      .getSnapshot()
      .pending.find((p) => p.entityId === product.id && p.field === 'price')
    const base = product.price
    const remotePrice = pendingPrice ? base + 5 : base + 10
    this.engine.simulateRemotePriceChange(product.id, product.name, remotePrice)
  }

  /** Dev: create a small, real local change so the queue has something to show. */
  async createPendingChange(): Promise<void> {
    await this.repository.adjustStock({
      productId: DEMO_PRODUCT_ID,
      type: 'add',
      quantity: 1,
      reason: 'restock',
      notes: 'Development control',
    })
  }

  setFailReads = (v: boolean) => this.devRepository.setFailReads(v)
  isFailingReads = () => this.devRepository.isFailingReads()
  resetDemoData = () => {
    this.engine.clearPending()
    this.devRepository.resetDemoData()
  }

  private maybeAutoRetry() {
    const s = this.engine.getSnapshot()
    if (s.phase === 'error' && preferencesStore.get().autoRetry && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        this.engine.syncNow()
      }, RETRY_DELAY_MS)
    }
  }
}
