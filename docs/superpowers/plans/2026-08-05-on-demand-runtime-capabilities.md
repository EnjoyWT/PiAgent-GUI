# On-Demand Runtime Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start new conversations with only core tools, let the model discover and activate registered tools and Skills without rebuilding pi-mono sessions, and remove the composer MCP selector.

**Architecture:** Register eligible definitions once, but resolve only a core allowlist at startup. Keep a process-local, per-conversation capability cache under a deterministic token budget. `capabilitySearch` reads the complete registry and `capabilityActivate` calls pi-mono's `setActiveToolsByName` at a tool-call boundary. The session loader retains a private Skill catalog but marks every Skill non-invocable for pi-mono's prompt formatter; `skillSearch` and `readSkillTool` expose it on demand.

**Tech Stack:** Electron, TypeScript, Vue 3, `@earendil-works/pi-coding-agent`, Node test runner.

---

## Scope and invariants

- The capability cache is process-local. An app restart returns to core-only; there is no SQLite migration, legacy data work, or event-delta persistence.
- Definitions can remain registered or their MCP connections pooled. Only the model-visible active allowlist is evicted.
- Cache selection is deterministic and local; it never performs an intent-classification model request.
- A capability may activate only when it is in the current session registry, workspace-authorized, surface-eligible, and still current.
- Existing workspace MCP bindings remain the authorization boundary. Removing the composer control must not remove MCP Settings.

## File map

| File | Change |
| --- | --- |
| `src/main/runtime-host/runtime-tool-layer/runtime-tool-registry.ts` | Define the core tool names and make all other definitions discoverable by default. |
| `src/main/runtime-host/runtime-tool-layer/runtime-tool-resolver.ts` | Merge core and valid cached names into the session allowlist. |
| `src/main/runtime-host/runtime-tool-layer/runtime-capability-state.ts` | New pure cache, deterministic selection, revision and budget eviction. |
| `src/main/tools/runtime-capability-tools.ts` | New search and guarded activation tools. |
| `src/main/runtime-host/coding-agent-runtime-bridge.ts` | Build full catalog, own cache map, use selected allowlist, wire activation to session, split Skill loaders, clean cache on disposal. |
| `src/main/runtime-host/runtime-system-prompt.ts` | State the search → activate → call protocol. |
| `src/renderer/src/components/chat/ChatInputBox.vue` | Remove MCP button, menu, binding mutations and list loading. |
| `tests/main/runtime-host/runtime-tool-resolver.test.ts` | Core-only and cached-tool resolver behavior. |
| `tests/main/runtime-host/runtime-capability-state.test.ts` | Cache retention, eviction, revision and source-version tests. |
| `tests/main/tools/runtime-capability-tools.test.ts` | Search and activation contract tests. |
| `tests/main/runtime-host/coding-agent-runtime-bridge.test.ts` | Session-boundary activation and prompt-budget tests. |
| `tests/renderer/chat/chat-input-mcp-selector.test.ts` | Composer MCP selector removal contract. |

### Task 1: Make the default profile core-only

**Files:**
- Modify: `src/main/runtime-host/runtime-tool-layer/runtime-tool-registry.ts`
- Modify: `src/main/runtime-host/runtime-tool-layer/runtime-tool-resolver.ts`
- Modify: `tests/main/runtime-host/runtime-tool-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test('default local resolution exposes only core and capability meta-tools', () => {
  const result = resolveRuntimeTools(registry, { surface: 'local', toolProfileId: 'default' })
  assert.deepEqual(result.activeToolNames, [
    'bash', 'capabilityActivate', 'capabilitySearch', 'edit', 'find', 'grep', 'ls', 'read', 'write'
  ])
  assert.equal(entry(result, 'webSearchTool')?.status, 'discoverable')
})

test('resolver adds valid cached names and leaves blocked names blocked', () => {
  const result = resolveRuntimeTools(registry, { surface: 'local', activeToolNames: ['webSearchTool', 'computerUseTool'] })
  assert.equal(result.activeToolNames.includes('webSearchTool'), true)
  assert.equal(entry(result, 'computerUseTool')?.status, 'blocked')
})
```

- [ ] **Step 2: Verify RED**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/runtime-tool-resolver.test.ts`

Expected: FAIL because capability meta-tools and core-only policy do not exist.

- [ ] **Step 3: Implement the minimal policy**

```ts
const CORE_TOOL_NAMES = new Set([
  'read', 'bash', 'edit', 'write', 'find', 'grep', 'ls', 'capabilitySearch', 'capabilityActivate'
])

const inferDefaultActive = (tool: Pick<ToolDefinition, 'name'>): boolean =>
  CORE_TOOL_NAMES.has(tool.name)
```

Resolve the requested names as `coreNames ∪ eligibleCacheNames`; preserve the existing scope checks and blocked reasons.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command. Expected: all resolver tests pass.

```bash
git add src/main/runtime-host/runtime-tool-layer/runtime-tool-registry.ts src/main/runtime-host/runtime-tool-layer/runtime-tool-resolver.ts tests/main/runtime-host/runtime-tool-resolver.test.ts
git commit -m "feat: default runtime tools to core capabilities"
```

### Task 2: Add a deterministic capability cache

**Files:**
- Create: `src/main/runtime-host/runtime-tool-layer/runtime-capability-state.ts`
- Create: `tests/main/runtime-host/runtime-capability-state.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test('keeps a recently used activated capability for the next turn', () => {
  const state = createRuntimeCapabilityState({ coreToolNames: ['read'], maxToolCount: 2, maxSchemaTokens: 3000 })
  state.activate([{ name: 'webSearchTool', schemaTokens: 120 }], 1)
  assert.deepEqual(state.selectForTurn(2), ['read', 'webSearchTool'])
})

test('evicts the least-recent non-pinned group over budget', () => {
  const state = createRuntimeCapabilityState({ coreToolNames: ['read'], maxToolCount: 3, maxSchemaTokens: 200 })
  state.activate([{ name: 'old', schemaTokens: 150 }], 1)
  state.activate([{ name: 'new', schemaTokens: 150 }], 2)
  assert.deepEqual(state.selectForTurn(3), ['read', 'new'])
})

test('drops an entry when its source version changes', () => {
  const state = createRuntimeCapabilityState({ coreToolNames: ['read'], maxToolCount: 2, maxSchemaTokens: 3000 })
  state.activate([{ name: 'mcpSearch', schemaTokens: 120, sourceVersion: 'v1' }], 1)
  assert.deepEqual(state.selectForTurn(2, { mcpSearch: 'v2' }), ['read'])
})
```

- [ ] **Step 2: Verify RED**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/runtime-capability-state.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the pure cache**

```ts
export type CapabilityLease = {
  name: string
  schemaTokens: number
  sourceVersion: string
  activatedAtTurn: number
  lastUsedTurn: number
  useCount: number
  pinned: boolean
  dependencies: string[]
}

export type RuntimeCapabilityState = {
  activate(entries: CapabilityDescriptor[], turn: number): ActivationResult
  markUsed(name: string, turn: number): void
  selectForTurn(turn: number, sourceVersions?: Record<string, string>): string[]
  clear(): void
  revision(): number
}
```

Sort groups by `pinned DESC`, `lastUsedTurn DESC`, `useCount DESC`, then name. Keep a dependency group only when all its names fit. The module performs no I/O and receives schema-token estimates from the caller.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command. Expected: all cache tests pass.

```bash
git add src/main/runtime-host/runtime-tool-layer/runtime-capability-state.ts tests/main/runtime-host/runtime-capability-state.test.ts
git commit -m "feat: add runtime capability cache"
```

### Task 3: Expose capability search and guarded activation

**Files:**
- Create: `src/main/tools/runtime-capability-tools.ts`
- Create: `tests/main/tools/runtime-capability-tools.test.ts`
- Modify: `src/main/runtime-host/runtime-tool-layer/runtime-tool-catalog.ts`
- Modify: `src/main/runtime-host/runtime-system-prompt.ts`

- [ ] **Step 1: Write failing tests**

```ts
test('capabilitySearch returns discoverable matches without schemas', async () => {
  const result = await search.execute('id', { query: 'search the web' }, undefined, undefined, {} as any)
  assert.equal((result.details as any).capabilities[0].name, 'webSearchTool')
  assert.equal('parameters' in (result.details as any).capabilities[0], false)
})

test('capabilityActivate rejects blocked entries without changing the allowlist', async () => {
  const result = await activate.execute('id', { names: ['computerUseTool'] }, undefined, undefined, {} as any)
  assert.deepEqual((result.details as any).activated, [])
  assert.match((result.details as any).rejected[0].reason, /Unavailable/)
})

test('capabilityActivate updates the next-step allowlist once', async () => {
  await activate.execute('id', { names: ['webSearchTool'] }, undefined, undefined, {} as any)
  assert.deepEqual(setActiveCalls, [['read', 'capabilitySearch', 'capabilityActivate', 'webSearchTool']])
})
```

- [ ] **Step 2: Verify RED**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/tools/runtime-capability-tools.test.ts`

Expected: FAIL because the tools are absent.

- [ ] **Step 3: Implement contracts and prompt rule**

```ts
export const createCapabilitySearchTool = ({ getCatalog }: { getCatalog: () => RuntimeToolCatalogEntry[] }) =>
  createSearchTool((query) => compactCatalog(getCatalog(), query))

export const createCapabilityActivateTool = ({ activate }: { activate: (names: string[]) => ActivationResult }) =>
  createActivateTool((names) => activate(names))
```

Search returns a bounded metadata-only list from the full registry. Activation revalidates current status, applies cache changes and calls the supplied session adapter once. Replace system-prompt wording so non-core operations must use search, activate, then call.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command. Expected: all capability-tool tests pass.

```bash
git add src/main/tools/runtime-capability-tools.ts src/main/runtime-host/runtime-tool-layer/runtime-tool-catalog.ts src/main/runtime-host/runtime-system-prompt.ts tests/main/tools/runtime-capability-tools.test.ts
git commit -m "feat: add on-demand capability tools"
```

### Task 4: Integrate pi-mono session switching and Skill discovery

**Files:**
- Modify: `src/main/runtime-host/coding-agent-runtime-bridge.ts`
- Modify: `src/main/runtime-host/runtime-tool-layer/base-runtime-tool-layer.ts`
- Modify: `tests/main/runtime-host/coding-agent-runtime-bridge.test.ts`

- [ ] **Step 1: Write failing bridge tests**

```ts
test('a new conversation creates a session with only core schemas', async () => {
  const session = await bridge.getOrCreateSessionForTest(conversation)
  assert.deepEqual(session.getActiveToolNames(), CORE_TOOL_NAMES)
})

test('activation is visible on the next agent step and next user turn', async () => {
  await bridge.activateForTest(conversation.id, ['webSearchTool'])
  assert.deepEqual(await bridge.nextRequestToolNames(conversation.id), [...CORE_TOOL_NAMES, 'webSearchTool'])
  assert.deepEqual(await bridge.nextTurnToolNames(conversation.id), [...CORE_TOOL_NAMES, 'webSearchTool'])
})

test('disposing a conversation clears its capability cache', async () => {
  await bridge.activateForTest(conversation.id, ['webSearchTool'])
  await bridge.disposeConversationForTest(conversation.id)
  assert.deepEqual(await bridge.nextTurnToolNames(conversation.id), CORE_TOOL_NAMES)
})
```

- [ ] **Step 2: Verify RED**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/coding-agent-runtime-bridge.test.ts`

Expected: FAIL because the bridge currently passes the full default allowlist.

- [ ] **Step 3: Implement bridge lifecycle**

Add `capabilityStateByConversationId: Map<string, RuntimeCapabilityState>`. Build a full catalog with `buildRuntimeToolCatalog(resolution.entries)`, rather than the existing active-only catalog. Register all already known definitions in `customTools`, but create the session with `state.selectForTurn(...)`. Build meta-tools before session creation and bind `capabilityActivate` to the live session through a closure after creation. Mark actual tool use, carry the in-memory state through same-process session recreation, and clear it on conversation disposal/deletion.

Keep the loader's complete Skill catalog in process, but return prompt-suppressed Skill entries to pi-mono so `formatSkillsForPrompt` emits no full metadata. `skillSearch` returns bounded metadata, and `readSkillTool` reads only a discovered enabled Skill.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command. Expected: bridge tests confirm dynamic active schema changes without a session rebuild.

```bash
git add src/main/runtime-host/coding-agent-runtime-bridge.ts src/main/runtime-host/runtime-tool-layer/base-runtime-tool-layer.ts tests/main/runtime-host/coding-agent-runtime-bridge.test.ts
git commit -m "feat: activate runtime capabilities on demand"
```

### Task 5: Remove MCP selection from the composer

**Files:**
- Modify: `src/renderer/src/components/chat/ChatInputBox.vue`
- Create: `tests/renderer/chat/chat-input-mcp-selector.test.ts`

- [ ] **Step 1: Write a failing source contract test**

```ts
test('chat composer does not render or mutate workspace MCP selection', () => {
  const source = readFileSync('src/renderer/src/components/chat/ChatInputBox.vue', 'utf8')
  assert.doesNotMatch(source, /aria-label="MCP servers"/)
  assert.doesNotMatch(source, /workspaceMcpServers\.setEnabled/)
  assert.doesNotMatch(source, /workspaceMcpServers\.clear/)
})
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/renderer/chat/chat-input-mcp-selector.test.ts`

Expected: FAIL because the current composer renders and mutates workspace MCP bindings.

- [ ] **Step 3: Remove only composer-owned MCP code**

Remove the Plug import, MCP hover/menu refs, loading/list state, database list requests, select-all/clear/toggle mutations, popover markup, and related mounted/watcher/click-outside branches. Do not change `McpSettings.vue`, MCP IPC handlers, or workspace binding APIs.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command. Expected: pass while model, thinking, sandbox, attachments and send controls remain.

```bash
git add src/renderer/src/components/chat/ChatInputBox.vue tests/renderer/chat/chat-input-mcp-selector.test.ts
git commit -m "feat: remove composer MCP selector"
```

### Task 6: Add prompt-budget diagnostics and complete verification

**Files:**
- Modify: `src/main/runtime-host/coding-agent-runtime-bridge.ts`
- Modify: `tests/main/runtime-host/coding-agent-runtime-bridge.test.ts`

- [ ] **Step 1: Write a failing budget test**

```ts
test('prompt budget separates core and cached schema estimates', () => {
  const budget = buildRuntimePromptBudget({ coreTools: [read], cachedTools: [webSearch], skills: [] })
  assert.equal(budget.cachedToolSchemaTokens > 0, true)
  assert.equal(budget.totalSchemaTokens, budget.coreToolSchemaTokens + budget.cachedToolSchemaTokens)
})
```

- [ ] **Step 2: Verify RED**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/coding-agent-runtime-bridge.test.ts`

Expected: FAIL because no budget breakdown exists.

- [ ] **Step 3: Implement local diagnostics**

Estimate schema tokens from serialized active definitions, categorize core/cache/Skill/MCP contributions, and emit a compact runtime diagnostic record. Never append stream-delta events or persist complete schemas.

- [ ] **Step 4: Verify GREEN and full checks**

Run:

```bash
node --experimental-strip-types --test tests/renderer/chat/chat-input-mcp-selector.test.ts
ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/runtime-tool-resolver.test.ts tests/main/runtime-host/runtime-capability-state.test.ts tests/main/tools/runtime-capability-tools.test.ts tests/main/runtime-host/coding-agent-runtime-bridge.test.ts
pnpm run typecheck
pnpm run build
```

Expected: all new focused tests, typecheck and build pass. Run `pnpm test:logic` separately and report its pre-existing five IM-settings failures unless independently fixed.

- [ ] **Step 5: Commit**

```bash
git add src/main/runtime-host/coding-agent-runtime-bridge.ts tests/main/runtime-host/coding-agent-runtime-bridge.test.ts
git commit -m "chore: measure runtime capability prompt budget"
```

## Plan self-review

- Tasks 1–4 cover core-only startup, full-catalog search, guarded activation, cache retention, Skill metadata suppression, and pi-mono switching.
- Task 5 removes only the composer selector and preserves workspace MCP authorization settings.
- Task 6 covers token measurement and verification without reintroducing stream-event persistence.
- All test steps have commands and expected outcomes; names used by later tasks are defined by earlier tasks.
