import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startBackendServer, createFileBackedStore } from './server'
import { startFrontendServer } from '../../../scripts/serve-frontend.mjs'
import { BackendApiClient } from '@/services/backendApi'
import { EscrowedStock } from '@/domain/stock'

describe('containerized frontend server and reverse proxy (scripts/serve-frontend.mjs)', () => {
  const tempDirs: string[] = []

  const makeTempDist = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'syncdesk-frontend-dist-'))
    tempDirs.push(dir)
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><div id="root">SyncDesk</div></body></html>')
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("syncdesk");')
    return dir
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serves /healthz, static assets, SPA fallback routes, and returns 404 for missing asset files', async () => {
    const distDir = makeTempDist()
    const frontend = await startFrontendServer({
      host: '127.0.0.1',
      port: 0,
      distDir,
      backendUpstreamUrl: 'http://127.0.0.1:9',
    })

    try {
      const healthz = await fetch(`http://127.0.0.1:${frontend.port}/healthz`)
      expect(healthz.status).toBe(200)
      await expect(healthz.json()).resolves.toEqual({ status: 'ok', service: 'syncdesk-frontend' })

      const assetRes = await fetch(`http://127.0.0.1:${frontend.port}/assets/app.js`)
      expect(assetRes.status).toBe(200)
      expect(assetRes.headers.get('content-type')).toContain('text/javascript')
      await expect(assetRes.text()).resolves.toContain('console.log("syncdesk")')

      for (const route of ['/', '/dashboard', '/products', '/stock/adjust', '/sync/pending']) {
        const spaRes = await fetch(`http://127.0.0.1:${frontend.port}${route}`)
        expect(spaRes.status).toBe(200)
        expect(spaRes.headers.get('content-type')).toContain('text/html')
        await expect(spaRes.text()).resolves.toContain('<div id="root">SyncDesk</div>')
      }

      const missingAsset = await fetch(`http://127.0.0.1:${frontend.port}/assets/missing.js`)
      expect(missingAsset.status).toBe(404)
    } finally {
      await frontend.close()
    }
  })

  it('proxies /api/* and /v1/* requests from BackendApiClient to the backend container upstream and survives backend container recreation', async () => {
    const distDir = makeTempDist()
    const storeDir = mkdtempSync(join(tmpdir(), 'syncdesk-docker-vol-'))
    tempDirs.push(storeDir)
    const storePath = join(storeDir, 'replica.json')

    let backend = await startBackendServer({
      host: '127.0.0.1',
      port: 0,
      replicaId: 'docker-backend',
      store: createFileBackedStore(storePath),
    })
    const backendPort = backend.port

    const frontend = await startFrontendServer({
      host: '127.0.0.1',
      port: 0,
      distDir,
      backendUpstreamUrl: `http://127.0.0.1:${backendPort}`,
    })

    try {
      const client = new BackendApiClient(`http://127.0.0.1:${frontend.port}/api`)
      const health = await client.health()
      expect(health.status).toBe('ok')

      await client.pushVersionedOperations([
        {
          schemaVersion: 2,
          operationId: 'docker-cat-1',
          replicaId: 'client-1',
          kind: 'category.patch',
          categoryId: 'c-drinks',
          version: { logicalTime: 1, replicaId: 'client-1', operationId: 'docker-cat-1' },
          changes: { name: 'Drinks', nameAr: 'مشروبات', description: 'Hot and cold drinks' },
        },
        {
          schemaVersion: 2,
          operationId: 'docker-prod-1',
          replicaId: 'client-1',
          kind: 'product.restore',
          productId: 'p-coffee',
          version: { logicalTime: 2, replicaId: 'client-1', operationId: 'docker-prod-1' },
          product: {
            id: 'p-coffee',
            name: 'Coffee',
            nameAr: 'قهوة',
            description: 'Filter coffee',
            descriptionAr: 'قهوة مصفاة',
            price: 120,
            categoryId: 'c-drinks',
            availability: 'available',
            stock: 48,
            lowStockThreshold: 15,
            updatedAt: 1001,
          },
        },
      ])

      const bootstrap1 = await client.registerReplica('client-1', { 'p-coffee': 48 })
      expect(bootstrap1.catalog.products).toHaveLength(1)
      expect(bootstrap1.allocation?.['p-coffee']).toBe(48)

      // Simulate backend container stop -> 502 from frontend proxy -> backend container recreated on same volume
      await backend.close()
      const unavailableRes = await fetch(`http://127.0.0.1:${frontend.port}/api/health`)
      expect(unavailableRes.status).toBe(502)

      backend = await startBackendServer({
        host: '127.0.0.1',
        port: backendPort,
        replicaId: 'docker-backend',
        store: createFileBackedStore(storePath),
      })

      const ledger = new EscrowedStock('client-1', bootstrap1.stockStates!['p-coffee']!)
      const tokenIds = Object.entries(ledger.snapshot().tokens)
        .filter(([, token]) => token.owner === 'client-1' && !token.consumedBy)
        .slice(0, 5)
        .map(([tokenId]) => tokenId)
      const [decOutcome] = await client.pushVersionedOperations([
        {
          schemaVersion: 2,
          operationId: 'docker-dec-1',
          kind: 'inventory.decrement',
          productId: 'p-coffee',
          replicaId: 'client-1',
          tokenIds,
          version: { logicalTime: 3, replicaId: 'client-1', operationId: 'docker-dec-1' },
        },
      ])
      expect(decOutcome?.stockOutcome?.status).toBe('applied')

      const bootstrap2 = await client.registerReplica('client-2')
      expect(bootstrap2.catalog.products.find((p) => p.id === 'p-coffee')?.stock).toBe(43)
    } finally {
      await frontend.close()
      await backend.close()
    }
  })
})
