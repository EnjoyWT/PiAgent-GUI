import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const electronStubUrl = pathToFileURL(resolve(repoRoot, 'tests/main/ipc/electron-ipc-stub.mjs')).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: electronStubUrl
      }
    }
    if (specifier.startsWith('@shared/')) {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)).href
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const { setupKnowledgeHandlers } = await import('../../../src/main/ipc/knowledge-handlers.ts')

test('setupKnowledgeHandlers registers knowledge IPC channels and delegates calls', async () => {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()

  const searchCalls: any[] = []
  const traceCalls: any[] = []
  const ingestCalls: any[] = []
  const mockStore = {
    getStats: () => ({ entities: 1, activeClaims: 2, patterns: 3, profiles: 4, relations: 5, vectors: 6 }),
    listActiveEntities: (limit: number) => [{ id: 'entity-1', limit }],
    getEntityExplorer: (entityId: string) => ({ entity: { id: entityId }, profiles: [], patterns: [], claims: [], relations: [] })
  } as any
  const mockDreamService = {
    runDreamCycle: async () => ({ processedEntities: 1, deduplicatedClaims: 0, archivedClaims: 0, patternsCreated: 1, profilesUpdated: 1, createdReflections: 1 })
  } as any

  const mockRetrievalService = {
    search(input: any) {
      searchCalls.push(input)
      return { query: input.query, items: [] }
    }
  } as any

  const mockTraceService = {
    trace(input: any) {
      traceCalls.push(input)
      return { claim: { id: input.claimId }, entity: null, evidenceRefs: [] }
    }
  } as any

  const mockIngestionService = {
    async ingestEpisode(input: any) {
      ingestCalls.push(input)
      return { insertedClaims: 1, skippedClaims: 0 }
    }
  } as any

  setupKnowledgeHandlers({
    ipcMainLike: {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: any[]) => Promise<any>)
        return undefined
      }
    },
    retrievalService: mockRetrievalService,
    traceService: mockTraceService,
    ingestionService: mockIngestionService,
    store: mockStore,
    dreamService: mockDreamService
  })

  // 1. Search channel
  const searchHandler = handlers.get('knowledge:search')
  assert.ok(searchHandler)
  const searchRes = await searchHandler(null, { query: 'PiAgent' })
  assert.deepEqual(searchCalls, [{ query: 'PiAgent' }])
  assert.deepEqual(searchRes, { query: 'PiAgent', items: [] })

  // 2. Trace channel
  const traceHandler = handlers.get('knowledge:trace')
  assert.ok(traceHandler)
  const traceRes = await traceHandler(null, { claimId: 'claim-123' })
  assert.deepEqual(traceCalls, [{ claimId: 'claim-123' }])
  assert.deepEqual(traceRes.claim, { id: 'claim-123' })

  // 3. Ingest channel
  const ingestHandler = handlers.get('knowledge:ingest-episode')
  assert.ok(ingestHandler)
  const ingestRes = await ingestHandler(null, { conversationId: 'conv-123' } as any)
  assert.deepEqual(ingestCalls, [{ conversationId: 'conv-123' }])
  assert.deepEqual(ingestRes, { insertedClaims: 1, skippedClaims: 0 })

  const settingsHandler = handlers.get('knowledge:settings:get')
  assert.ok(settingsHandler)
  const settings = await settingsHandler(null)
  assert.equal(typeof settings.enabled, 'boolean')

  const statsHandler = handlers.get('knowledge:stats')
  assert.ok(statsHandler)
  assert.deepEqual(await statsHandler(null), { entities: 1, activeClaims: 2, patterns: 3, profiles: 4, relations: 5, vectors: 6 })

  const entitiesHandler = handlers.get('knowledge:entities:list')
  assert.ok(entitiesHandler)
  assert.deepEqual(await entitiesHandler(null, 10), [{ id: 'entity-1', limit: 10 }])

  const entityHandler = handlers.get('knowledge:entity:get')
  assert.ok(entityHandler)
  assert.deepEqual(await entityHandler(null, 'entity-1'), { entity: { id: 'entity-1' }, profiles: [], patterns: [], claims: [], relations: [] })

  const dreamHandler = handlers.get('knowledge:dream:run')
  assert.ok(dreamHandler)
  assert.equal((await dreamHandler(null, { force: true })).processedEntities, 1)

  assert.ok(handlers.get('knowledge:embedding-models:list'))
  assert.ok(handlers.get('knowledge:embedding-models:download'))
  assert.ok(handlers.get('knowledge:embedding-models:open-cache-dir'))
})
