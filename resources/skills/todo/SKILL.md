---
name: todo
description: Manage a structured task list using a Markdown file in the workspace. Track progress on complex multi-step tasks. File-based — just Read and Write the todo file.
allowed-tools:
  - Read
  - Write
---

# Todo Skill

For complex multi-step work, use a Markdown file at `.piagent/todos-<THREAD_ID>.md` in the current workspace directory. Use the Thread ID from the system prompt to create the filename (e.g., `.piagent/todos-abc123.md`). This prevents conflicts when multiple threads share the same workspace.

This is optional coordination, not a default action for every request. Only create or update the file when explicit task tracking materially helps the task.

## File Format

```markdown
# Todos

- [x] Fix authentication bug
- [ ] ~Add unit tests~ _(in progress)_
- [ ] Update documentation
- [ ] Write changelog
```

### Status markers

- `- [ ]` — pending
- `- [ ] ~Task name~ *(in progress)*` — currently working on
- `- [x]` — completed

## How to Use

1. **Read** the file to see current tasks: `Read .piagent/todos-<THREAD_ID>.md`
2. **Write** the file to update tasks: `Write .piagent/todos-<THREAD_ID>.md`
3. Create the `.piagent/` directory if it doesn't exist

## Rules

- Only ONE task should be _in progress_ at a time
- Mark tasks `[x]` IMMEDIATELY after finishing — don't batch
- Keep the full list when updating (this is a replace, not append)
- Add new tasks at the bottom

## When to Use

- Complex multi-step tasks (3+ meaningful steps)
- User provides multiple related tasks
- User explicitly asks for a task list
- Non-trivial work requiring progress tracking

## When NOT to Use

- Single, simple tasks
- Quick conversational responses
- Tasks completable in <3 steps

## Example Session

First, create the file:

```
Write .piagent/todos-<THREAD_ID>.md

# Todos

- [ ] ~Refactor database layer~ *(in progress)*
- [ ] Add migration support
- [ ] Update API endpoints
- [ ] Write tests
```

After completing first task:

```
Write .piagent/todos-<THREAD_ID>.md

# Todos

- [x] Refactor database layer
- [ ] ~Add migration support~ *(in progress)*
- [ ] Update API endpoints
- [ ] Write tests
```
