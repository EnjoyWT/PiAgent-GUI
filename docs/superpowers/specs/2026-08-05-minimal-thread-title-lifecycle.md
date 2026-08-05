# Minimal Thread Title Lifecycle

## Goal

Keep asynchronous title refinement while preventing a cancelled or failed first
run from changing a thread title later.

## Rules

1. A `finished` run keeps the existing 250 ms delayed refinement.
2. An `aborted` or `failed` run immediately calls the existing title coordinator
   before any asynchronous queue refresh. The coordinator removes its pending
   title and leaves the current fallback title unchanged.
3. No generation token, background-job queue, or new persistence state is
   introduced.

## Scope boundary

If a delayed `finished` callback fires after a thread was deleted, the existing
coordinator's current-title check prevents persistence because the thread is no
longer present. That callback may perform unnecessary work, but it cannot
rename a deleted or replaced thread. Avoiding that work is intentionally out of
scope for this minimal correction.

## Tests

- `aborted` and `failed` clear a pending title synchronously.
- `finished` remains delayed by 250 ms and may refine the fallback title.
- Dispatcher tests assert the lifecycle notification happens before any queue
  refresh await.
