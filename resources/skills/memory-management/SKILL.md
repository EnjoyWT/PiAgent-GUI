---
name: memory-management
description: Search and manage PiAgent's long-term memory and local conversation history. Use when the user asks about past discussions, durable preferences, project facts, or explicitly asks you to remember or forget something.
allowed-tools:
  - Bash
  - Read
  - Write
---

# Memory Management Skill

PiAgent exposes memory through the `piagent` CLI. Use the CLI instead of reading SQLite files directly.

## Commands

```bash
# Search durable memories
piagent memory search <query>

# List memories (default: scope=all)
piagent memory list

# Store a new memory
piagent memory add <content>

# Delete a memory by id
piagent memory delete <id>

# View memory stats
piagent memory stats

# Keyword search past chat history
piagent memory grep <keyword>
```

## When to Use

- User asks about something discussed before: search memory first, then grep history if needed
- User says "remember this": store it with `piagent memory add "..."`
- User says "forget this" or wants a memory removed: obtain candidate ids with `piagent memory search <query>` or `piagent memory list`, then `piagent memory delete <id>`
- User asks about preferences, workflow rules, or stable project facts: prefer `piagent memory search "<query>"`
- User wants the exact previous wording: use `piagent memory grep`

## Search Strategy

Use two layers when recalling past information:

1. `piagent memory search "<query>"` for durable facts
2. `piagent memory grep "<keyword>"` for exact historical wording

If one returns nothing, try the other.

## Storage Rules

- Only store durable facts, preferences, workflow rules, or stable project context
- Do not store transient errors, large logs, secrets, or speculative guesses
- When a fact is clearly project-specific, run the command from the relevant workspace so it is stored under that workspace scope

## Scope Filtering (`--scope`)

For `piagent memory search`, `piagent memory list`, and `piagent memory stats`:

- `--scope` is optional.
- If `--scope` is omitted, the default behavior is equivalent to `--scope all` (no scope-kind filtering).
- Supported `--scope` values: `global`, `workspace`, `session`, `person`, `self`, `all`.
- `--scope workspace`: filters to the workspace scope of the current CLI `cwd`. Use `--scope-ref <path>` to override the workspace reference.
- `--scope global`: filters to global scope only.
- `--scope person/session/self`: filters to the corresponding scope kind. Use `--scope-ref <value>` to additionally filter by `scope_ref` when applicable.

## Tips

- Confirm with the user what you stored or deleted
- Search before adding if duplication is likely
- Prefer concise factual phrasing when adding a memory
