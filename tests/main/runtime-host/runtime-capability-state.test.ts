import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeCapabilityState } from '../../../src/main/runtime-host/runtime-tool-layer/runtime-capability-state.ts'

test('keeps a recently activated capability for the next turn', () => {
  const state = createRuntimeCapabilityState({
    coreToolNames: ['read'],
    maxToolCount: 2,
    maxSchemaTokens: 3000
  })

  state.activate([{ name: 'webSearchTool', schemaTokens: 120 }], 1)

  assert.deepEqual(state.selectForTurn(2), ['read', 'webSearchTool'])
})

test('evicts the least-recent non-pinned capability when schema budget is exceeded', () => {
  const state = createRuntimeCapabilityState({
    coreToolNames: ['read'],
    maxToolCount: 3,
    maxSchemaTokens: 200
  })

  state.activate([{ name: 'old', schemaTokens: 150 }], 1)
  state.activate([{ name: 'new', schemaTokens: 150 }], 2)

  assert.deepEqual(state.selectForTurn(3), ['read', 'new'])
})

test('keeps pinned capabilities ahead of more recent unpinned capabilities', () => {
  const state = createRuntimeCapabilityState({
    coreToolNames: ['read'],
    maxToolCount: 2,
    maxSchemaTokens: 200
  })

  state.activate([{ name: 'pinned', schemaTokens: 150, pinned: true }], 1)
  state.activate([{ name: 'recent', schemaTokens: 150 }], 2)

  assert.deepEqual(state.selectForTurn(3), ['read', 'pinned'])
})

test('drops a cached capability when its source version changes', () => {
  const state = createRuntimeCapabilityState({
    coreToolNames: ['read'],
    maxToolCount: 2,
    maxSchemaTokens: 3000
  })

  state.activate([{ name: 'mcpSearch', schemaTokens: 120, sourceVersion: 'v1' }], 1)

  assert.deepEqual(state.selectForTurn(2, { mcpSearch: 'v2' }), ['read'])
})

test('increments revision only when the capability set changes', () => {
  const state = createRuntimeCapabilityState({
    coreToolNames: ['read'],
    maxToolCount: 2,
    maxSchemaTokens: 3000
  })

  assert.equal(state.revision(), 0)
  state.activate([{ name: 'webSearchTool', schemaTokens: 120 }], 1)
  assert.equal(state.revision(), 1)
  state.markUsed('webSearchTool', 2)
  assert.equal(state.revision(), 1)
  state.clear()
  assert.equal(state.revision(), 2)
})
