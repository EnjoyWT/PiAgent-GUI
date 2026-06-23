import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
      }
    }
    if (specifier.startsWith('@shared/')) {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)).href
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const { migrateKnowledgeDb } = await import('../../../src/main/knowledge/knowledge-db.ts')
const { KnowledgeStore } = await import('../../../src/main/knowledge/knowledge-store.ts')
const { KnowledgeDreamService } = await import('../../../src/main/knowledge/knowledge-dream-service.ts')

test('KnowledgeDreamService runs five-stage dream cycle', async () => {
  const db = new Database(':memory:')
  migrateKnowledgeDb(db)
  const store = new KnowledgeStore(db)
  const dreamService = new KnowledgeDreamService(store, db)

  const personId = store.upsertEntity({ type: 'person', canonicalName: 'Bob' })
  store.insertClaim({ entityId: personId, kind: 'preference', text: 'Bob prefers working early in the morning', importance: 0.8 })
  store.insertClaim({ entityId: personId, kind: 'fact', text: 'Bob lives in Seattle', importance: 0.6 })
  store.insertClaim({ entityId: personId, kind: 'fact', text: 'Bob lives in Seattle', importance: 0.6 })

  const projectId = store.upsertEntity({ type: 'project', canonicalName: 'Delta' })
  store.insertClaim({ entityId: projectId, kind: 'decision', text: 'Delta project is suspended', importance: 0.9 })

  const result = await dreamService.runDreamCycle({ force: true })
  assert.equal(result.processedEntities, 2)
  assert.equal(result.deduplicatedClaims, 1)
  assert.equal(result.createdReflections, 2)
  assert.ok(result.profilesUpdated >= 0)

  const personReflections = store.getReflectionsForEntity(personId)
  assert.ok(personReflections.some((r) => r.reflectionType === 'person_profile'))
  const personProfile = personReflections.find((r) => r.reflectionType === 'person_profile')!
  assert.ok(personProfile.body.includes('Seattle'))
  assert.ok(personProfile.body.includes('morning'))

  const activeSeattle = store.searchClaims({ query: 'Seattle', entityId: personId, limit: 10 })
  assert.equal(activeSeattle.length, 1)

  const projectReflections = store.getReflectionsForEntity(projectId)
  assert.ok(projectReflections.some((r) => r.reflectionType === 'project_state'))
})
