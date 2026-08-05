# Minimal Thread Title Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep completed-run title refinement asynchronous while making aborted and failed runs retain the existing fallback title.

**Architecture:** Reuse `threadTitleCoordinator` and the existing 250 ms finished-run delay. The queue dispatcher sends `aborted` and `failed` to the existing scheduler before it awaits queue/database refresh; the scheduler calls the coordinator immediately for those statuses, which removes its pending entry. No new background-job abstraction or persistent state is added.

**Tech Stack:** Vue 3 renderer, TypeScript, Node built-in test runner.

---

### Task 1: Clear non-finished title work before asynchronous refresh

**Files:**
- Modify: `src/renderer/src/utils/app-queue-dispatcher.ts:686-775`
- Modify: `tests/renderer/chat/app-queue-dispatcher.test.ts`
- Test: `tests/renderer/chat/thread-title-lifecycle.test.ts`

- [ ] **Step 1: Write a failing dispatcher test for a failed first run**

Add a test that reserves the first-run title through the existing coordinator, invokes the dispatcher with `status: 'failed'`, and asserts the lifecycle call is observed before a controlled `loadLatestThreadWindow` promise resolves. After resolving it, invoke a finished lifecycle event and assert `generateTitle` was not called. Keep the existing aborted interleaving test.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --experimental-strip-types --test tests/renderer/chat/app-queue-dispatcher.test.ts
```

Expected: the new failed-run assertion fails because `failed` is currently delivered only after asynchronous refresh.

- [ ] **Step 3: Move the failed lifecycle cleanup before the first await**

In `onRunSettled`, make the pre-refresh branch handle both non-finished terminal statuses:

```ts
if (status === 'aborted' || status === 'failed') {
  options.refineThreadTitleAfterRun({ threadId, status })
}
```

Remove `failed` and `aborted` from the final lifecycle condition so it is only:

```ts
if (status === 'finished') {
  options.refineThreadTitleAfterRun({ threadId, status })
}
```

- [ ] **Step 4: Run focused and renderer verification**

Run:

```bash
node --experimental-strip-types --test tests/renderer/chat/app-queue-dispatcher.test.ts tests/renderer/chat/thread-title-lifecycle.test.ts
pnpm run test:logic
pnpm run typecheck:web
```

Expected: all commands exit 0. The focused test proves abort/failed cleanup is synchronous and finished remains delayed.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/renderer/src/utils/app-queue-dispatcher.ts tests/renderer/chat/app-queue-dispatcher.test.ts tests/renderer/chat/thread-title-lifecycle.test.ts
git commit -m "fix: clear terminal title refinements synchronously"
```
