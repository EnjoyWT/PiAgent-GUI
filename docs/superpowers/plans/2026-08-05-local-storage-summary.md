# 本地数据与存储摘要 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「设置 → 通用」显示本地对话数据库及相关数据库的实际磁盘占用，并支持手动刷新。

**Architecture:** 主进程的独立服务只统计用户数据目录内的固定 SQLite 文件及其 WAL/SHM 伴随文件。专用 IPC 将只读摘要传到 preload，渲染层通过受限 API 展示加载、失败与刷新状态。

**Tech Stack:** Electron IPC、Node `fs/promises`、Vue 3、TypeScript、Node test runner。

---

### Task 1: 统计固定本地数据库的实际占用

**Files:**
- Create: `src/shared/app-storage.ts`
- Create: `src/main/app-storage/app-storage-summary.ts`
- Test: `tests/main/app-storage/app-storage-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('includes SQLite database, WAL and SHM sizes in the matching database total', async () => {
  const summary = await getAppStorageSummary('/data', {
    stat: async (path) => ({ size: new Map([
      ['/data/core-v2.db', 10], ['/data/core-v2.db-wal', 4], ['/data/core-v2.db-shm', 2]
    ]).get(path) ?? 0 })
  })
  assert.equal(summary.conversationDatabase.totalBytes, 16)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/app-storage/app-storage-summary.test.ts`

Expected: FAIL because `app-storage-summary.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create shared types for a database row (`fileName`, `label`, `databaseBytes`, `sidecarBytes`, `totalBytes`) and summary (`userDataPath`, `conversationDatabase`, `databases`, `totalBytes`). Implement `getAppStorageSummary(userDataPath, deps?)` over exactly `core-v2.db`, `context.db`, `knowledge.db`, and `config.db`; use `Promise.all` to read the main, `-wal`, and `-shm` files. Convert any individual stat failure to 0, sum the three values, and select `core-v2.db` as `conversationDatabase`.

- [ ] **Step 4: Run test to verify it passes**

Run the Task 1 test command. Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/shared/app-storage.ts src/main/app-storage/app-storage-summary.ts tests/main/app-storage/app-storage-summary.test.ts && git commit -m "feat: summarize local database storage"`

### Task 2: 通过受限 IPC 暴露只读摘要

**Files:**
- Create: `src/main/ipc/app-storage-handlers.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Test: `tests/main/ipc/app-storage-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('registers app-storage:get-summary and returns the storage summary', async () => {
  const handlers = new Map<string, Function>()
  setupAppStorageHandlers({
    ipcMainLike: { handle: (channel, handler) => handlers.set(channel, handler) },
    getUserDataPath: () => '/data',
    getSummary: async (path) => ({ userDataPath: path, totalBytes: 42, databases: [], conversationDatabase: {} })
  })
  assert.equal((await handlers.get('app-storage:get-summary')!(null)).totalBytes, 42)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/ipc/app-storage-handlers.test.ts`

Expected: FAIL because `setupAppStorageHandlers` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `setupAppStorageHandlers` with injectable dependencies for the IPC unit test. In production it calls `app.getPath('userData')` and `getAppStorageSummary`; register it in `app.whenReady()` with the other one-time IPC setup calls. Add `window.api.appStorage.getSummary()` in preload and its declaration, returning the shared summary type only.

- [ ] **Step 4: Run test to verify it passes**

Run the Task 2 test command. Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/main/ipc/app-storage-handlers.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts tests/main/ipc/app-storage-handlers.test.ts && git commit -m "feat: expose local storage summary"`

### Task 3: 在通用设置展示摘要与刷新状态

**Files:**
- Modify: `src/renderer/src/windows/settings/components/GeneralSettings.vue`
- Test: `tests/renderer/general-settings-storage-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('general settings includes the local data storage section and refresh action', () => {
  const source = readFileSync(resolve(repoRoot, 'src/renderer/src/windows/settings/components/GeneralSettings.vue'), 'utf8')
  assert.match(source, /本地数据与存储/)
  assert.match(source, /window\.api\.appStorage\.getSummary\(\)/)
  assert.match(source, /刷新/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/renderer/general-settings-storage-summary.test.ts`

Expected: FAIL because the section and API call do not exist.

- [ ] **Step 3: Write minimal implementation**

Add a card below the tool model card. On mount, request the summary in parallel with the existing model setup. Show “对话数据库”, “本地数据库合计”, the truncated data directory, a non-persistent refresh button, and a concise loading/error state. Use a local byte formatter; disable only the refresh button while its request is active. Do not create cleanup controls or persist UI state.

- [ ] **Step 4: Run test to verify it passes**

Run the Task 3 test command. Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/renderer/src/windows/settings/components/GeneralSettings.vue tests/renderer/general-settings-storage-summary.test.ts && git commit -m "feat: show local storage summary in settings"`

### Task 4: 端到端静态验证

**Files:**
- Modify: none

- [ ] **Step 1: Run focused tests**

Run: `ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/app-storage/app-storage-summary.test.ts tests/main/ipc/app-storage-handlers.test.ts && node --experimental-strip-types --test tests/renderer/general-settings-storage-summary.test.ts`

Expected: PASS.

- [ ] **Step 2: Run renderer type checking**

Run: `pnpm run typecheck:web`

Expected: PASS.
