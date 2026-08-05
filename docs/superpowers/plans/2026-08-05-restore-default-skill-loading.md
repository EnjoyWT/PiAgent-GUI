# Restore Default Skill Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore default pi-mono loading for configuration-enabled Skills while retaining on-demand Skill body reading and on-demand non-core tools.

**Architecture:** Remove the private Skill catalog and `skillSearch` indirection. The existing resource loader discovers Skills normally, and its override only marks `skills_disabled` entries unavailable. pi-mono emits its standard Skill metadata directory for enabled entries; `readSkillTool` reads full content when selected.

**Tech Stack:** Electron, TypeScript, `@earendil-works/pi-coding-agent`, Node test runner.

---

### Task 1: Restore the default Skill loader path

**Files:**

- Modify: `src/main/runtime-host/coding-agent-runtime-bridge.ts`
- Modify: `tests/main/runtime-host/coding-agent-runtime-bridge.test.ts`

- [ ] **Step 1: Write the failing enabled-Skill test**

```ts
assert.equal(loader.getSkills().skills.find((skill) => skill.name === 'pdf')?.disableModelInvocation, false)
```

- [ ] **Step 2: Verify RED**

```bash
ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/coding-agent-runtime-bridge.test.ts
```

Expected: the assertion fails because every Skill is currently hidden.

- [ ] **Step 3: Implement minimal default loading**

```ts
skillsOverride: (current) => ({
  ...({ [legacySkillDoctorKey]: Reflect.get(current, legacySkillDoctorKey) } as Omit<typeof current, 'skills'>),
  skills: current.skills.map((skill) =>
    disabledSet.has(skill.name) ? { ...skill, disableModelInvocation: true } : skill
  )
})
```

Remove `skillCatalogByConversationId`; use `loader.getSkills().skills` for `readSkillTool`; remove `skillSearchTool` registration and guidance.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command; then:

```bash
git add src/main/runtime-host/coding-agent-runtime-bridge.ts tests/main/runtime-host/coding-agent-runtime-bridge.test.ts
git commit -m "fix: restore default Skill loading"
```

### Task 2: Remove redundant Skill search

**Files:**

- Modify: `src/main/runtime-host/runtime-tool-layer/runtime-tool-registry.ts`
- Delete: `src/main/tools/skill-search-tool.ts`
- Modify: `tests/main/runtime-host/runtime-tool-resolver.test.ts`
- Delete: `tests/main/tools/skill-search-tool.test.ts`

- [ ] **Step 1: Make the resolver expectation fail**

Remove `skillSearch` from the expected core allowlist, then run:

```bash
ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/runtime-tool-resolver.test.ts
```

Expected: failure because `skillSearch` remains active.

- [ ] **Step 2: Remove implementation and verify GREEN**

Remove `skillSearch` from `CORE_TOOL_NAMES` and discovery classification, delete its implementation/test, keep `readSkillTool` core, then run:

```bash
ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/runtime-tool-resolver.test.ts tests/main/tools/read-skill-tool.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -u
git add src/main/runtime-host/runtime-tool-layer/runtime-tool-registry.ts tests/main/runtime-host/runtime-tool-resolver.test.ts
git commit -m "refactor: remove redundant Skill search"
```

### Task 3: Verify integrated runtime

**Files:**

- Modify: `docs/decisions/2026-08-05-on-demand-runtime-capabilities.md`

- [ ] **Step 1: Update decision**

Document that enabled Skills use the pi-mono default metadata directory and Skill bodies remain on-demand through `readSkillTool`.

- [ ] **Step 2: Verify**

```bash
pnpm run typecheck
pnpm test:logic
ELECTRON_RUN_AS_NODE=1 pnpm exec electron --experimental-transform-types --experimental-specifier-resolution=node --test tests/main/runtime-host/coding-agent-runtime-bridge.test.ts tests/main/runtime-host/runtime-capability-state.test.ts tests/main/runtime-host/runtime-tool-resolver.test.ts tests/main/tools/runtime-capability-tools.test.ts tests/main/tools/read-skill-tool.test.ts
pnpm run build
```

- [ ] **Step 3: Commit docs**

```bash
git add -f docs/decisions/2026-08-05-on-demand-runtime-capabilities.md docs/superpowers/plans/2026-08-05-restore-default-skill-loading.md
git commit -m "docs: restore default Skill loading decision"
```
