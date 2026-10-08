import type { Category, Product, StockAdjustment } from '@/domain/types'
import type { ActivityEvent } from '@/domain/sync'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const THIS_DEVICE_ID = 'dev-counter'

export interface Seed {
  categories: Category[]
  products: Product[]
  adjustments: StockAdjustment[]
  activity: ActivityEvent[]
  lastSyncAt: number
}

export interface PeerSeed {
  id: string
  name: string
  role: 'Kitchen display' | 'Manager mobile' | 'Back office' | 'Stock scanner'
  replicaId: string
  status: 'online' | 'offline' | 'unknown' | 'evicted'
  lastSeenAgoMs: number | null
  lastSyncAgoMs: number | null
  pendingChanges: number
  stateSizeBytes: number
  metadataBytes: number
  platform: string
}

/** Peers are simulated: their figures are fixed seed values, not measurements. */
export const PEER_SEEDS: PeerSeed[] = [
  {
    id: 'dev-kitchen',
    name: 'Kitchen display',
    role: 'Kitchen display',
    replicaId: 'replica-c91d',
    status: 'online',
    lastSeenAgoMs: 40_000,
    lastSyncAgoMs: 2 * MIN,
    pendingChanges: 0,
    stateSizeBytes: 41_900,
    metadataBytes: 17_800,
    platform: 'Android tablet',
  },
  {
    id: 'dev-manager',
    name: 'Manager phone',
    role: 'Manager mobile',
    replicaId: 'replica-5be0',
    status: 'offline',
    lastSeenAgoMs: 3 * HOUR + 12 * MIN,
    lastSyncAgoMs: 3 * HOUR + 14 * MIN,
    pendingChanges: 2,
    stateSizeBytes: 40_300,
    metadataBytes: 17_100,
    platform: 'Android phone',
  },
  {
    id: 'dev-office',
    name: 'Back-office laptop',
    role: 'Back office',
    replicaId: 'replica-1e84',
    status: 'unknown',
    lastSeenAgoMs: 2 * DAY,
    lastSyncAgoMs: 2 * DAY,
    pendingChanges: 0,
    stateSizeBytes: 39_800,
    metadataBytes: 16_400,
    platform: 'Windows laptop',
  },
  {
    id: 'dev-scanner',
    name: 'Stockroom scanner',
    role: 'Stock scanner',
    replicaId: 'replica-77ac',
    status: 'evicted',
    lastSeenAgoMs: 19 * DAY,
    lastSyncAgoMs: 19 * DAY,
    pendingChanges: 0,
    stateSizeBytes: 31_200,
    metadataBytes: 12_900,
    platform: 'Handheld scanner',
  },
]

export function buildSeed(now: number): Seed {
  const categories: Category[] = [
    { id: 'c-drinks', name: 'Drinks', nameAr: 'مشروبات', description: 'Hot and cold beverages served at the counter.', updatedAt: now - 9 * DAY },
    { id: 'c-food', name: 'Food', nameAr: 'طعام', description: 'Savoury items prepared in the kitchen.', updatedAt: now - 9 * DAY },
    { id: 'c-desserts', name: 'Desserts', nameAr: 'حلويات', description: 'Pastries, cakes and sweets.', updatedAt: now - 6 * DAY },
  ]

  const p = (
    id: string,
    name: string,
    nameAr: string,
    description: string,
    descriptionAr: string,
    price: number,
    categoryId: string,
    stock: number,
    lowStockThreshold: number,
    ageMs: number,
    availability: Product['availability'] = 'available',
  ): Product => ({
    id,
    name,
    nameAr,
    description,
    descriptionAr,
    price,
    categoryId,
    availability,
    stock,
    lowStockThreshold,
    updatedAt: now - ageMs,
  })

  const products: Product[] = [
    p('p-coffee', 'Coffee', 'قهوة', 'Filter coffee, served hot in a 25 cl cup.', 'قهوة مصفاة تقدم ساخنة في كوب سعة 25 سل.', 120, 'c-drinks', 48, 15, 50 * MIN),
    p('p-espresso', 'Espresso', 'إسبريسو', 'Single shot of espresso.', 'جرعة إسبريسو واحدة.', 100, 'c-drinks', 12, 20, 3 * HOUR),
    p('p-tea', 'Tea', 'شاي', 'Mint or black tea served in a glass.', 'شاي بالنعناع أو أسود يقدم في كأس.', 80, 'c-drinks', 34, 10, 1 * DAY),
    p('p-orange', 'Orange juice', 'عصير برتقال', 'Freshly squeezed, 30 cl.', 'عصير برتقال طازج، 30 سل.', 150, 'c-drinks', 18, 8, 2 * DAY),
    p('p-water', 'Water', 'ماء', 'Still mineral water, 50 cl bottle.', 'ماء معدني، قارورة 50 سل.', 40, 'c-drinks', 0, 24, 5 * HOUR),
    p('p-croissant', 'Croissant', 'كرواسون', 'Butter croissant, baked each morning.', 'كرواسون بالزبدة يخبز كل صباح.', 70, 'c-food', 6, 10, 4 * HOUR),
    p('p-sandwich', 'Sandwich', 'ساندويتش', 'Chicken and crudités on a demi-baguette.', 'دجاج وخضار طازجة في نصف باغيت.', 350, 'c-food', 22, 8, 1 * DAY),
    p('p-quiche', 'Quiche', 'كيش', 'Spinach and cheese quiche, single portion.', 'كيش بالسبانخ والجبن، حصة فردية.', 260, 'c-food', 9, 6, 3 * DAY),
    p('p-cake', 'Chocolate cake', 'كعكة الشوكولاتة', 'Dark chocolate cake, per slice.', 'كعكة شوكولاتة داكنة، قطعة.', 280, 'c-desserts', 14, 5, 2 * DAY),
    p('p-baklawa', 'Baklawa', 'بقلاوة', 'Almond baklawa, box of four pieces.', 'بقلاوة باللوز، علبة من أربع قطع.', 320, 'c-desserts', 25, 8, 6 * DAY),
    p('p-tiramisu', 'Tiramisu', 'تيراميسو', 'Individual tiramisu cup. Seasonal.', 'كأس تيراميسو فردي. موسمي.', 300, 'c-desserts', 4, 6, 8 * DAY, 'unavailable'),
  ]

  const adj = (
    id: string,
    productId: string,
    type: StockAdjustment['type'],
    delta: number,
    reason: StockAdjustment['reason'],
    resultingStock: number,
    ageMs: number,
    notes = '',
    deviceId = THIS_DEVICE_ID,
  ): StockAdjustment => ({ id, productId, type, delta, reason, notes, resultingStock, createdAt: now - ageMs, deviceId })

  const adjustments: StockAdjustment[] = [
    adj('adj-1', 'p-coffee', 'add', 24, 'restock', 48, 6 * HOUR, 'Weekly delivery'),
    adj('adj-2', 'p-espresso', 'remove', -3, 'waste', 12, 3 * HOUR, 'Spilled tray', 'dev-kitchen'),
    adj('adj-3', 'p-water', 'remove', -6, 'sale', 0, 5 * HOUR),
    adj('adj-4', 'p-croissant', 'remove', -4, 'sale', 6, 4 * HOUR),
    adj('adj-5', 'p-tea', 'add', 12, 'restock', 34, 1 * DAY),
    adj('adj-6', 'p-cake', 'correct', -1, 'correction', 14, 2 * DAY, 'Counted at close'),
  ]

  const dev = THIS_DEVICE_ID
  const ev = (id: string, ageMs: number, kind: ActivityEvent['kind'], title: string, detail?: string, deviceId = dev): ActivityEvent => ({
    id,
    at: now - ageMs,
    kind,
    title,
    detail,
    deviceId,
  })

  const activity: ActivityEvent[] = [
    ev('seed-1', 2 * MIN, 'converged', 'Replicas converged', 'Pending changes: 0'),
    ev('seed-2', 2 * MIN + 2_000, 'merge-completed', 'Merge completed'),
    ev('seed-3', 2 * MIN + 4_000, 'state-received', 'State received', '1 remote change'),
    ev('seed-4', 2 * MIN + 6_000, 'sync-started', 'Synchronization started', '0 local changes to send'),
    ev('seed-5', 9 * MIN, 'remote-applied', 'Remote change applied: Espresso stock', 'Kitchen display', 'dev-kitchen'),
    ev('seed-6', 50 * MIN, 'change-created', 'Local change created: Price 110 DA → 120 DA', 'Coffee'),
    ev('seed-7', 3 * HOUR, 'device', 'Kitchen display connected', 'replica-c91d', 'dev-kitchen'),
    ev('seed-8', 3 * HOUR + 12 * MIN, 'connection-lost', 'Manager phone disconnected', 'replica-5be0', 'dev-manager'),
  ]

  return { categories, products, adjustments, activity, lastSyncAt: now - 2 * MIN }
}
