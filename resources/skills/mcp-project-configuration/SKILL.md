---
name: mcp-project-configuration
description: Use when the user asks to configure, install, enable, disable, remove, audit, or troubleshoot MCP servers for the current PiAgent project or workspace, including missing MCP tools or wiring a server into Settings.
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
---

# MCP Project Configuration

Guide PiAgent users through installing and managing MCP servers for a workspace. Use the `piagent mcp` CLI as the configuration boundary; do not expose internal storage details or ask the model to edit app data directly.

## Trigger Fit

Use this skill when the user asks to:

- Configure MCP for the current project or workspace.
- Install, add, enable, disable, list, or remove MCP servers.
- Add a local stdio MCP server or a remote HTTP/SSE MCP server.
- Diagnose why installed MCP tools do not appear in the agent runtime.
- Recover from MCP marketplace failures by manually adding a trusted server definition.

Do not use this skill for PiAgent agent-plugin conversion. Use `piagent-plugin-adapter` for plugin packages that contain `.piagent-agent-plugin/plugin.json`.

## PiAgent MCP Model

PiAgent has two user-facing MCP concepts:

| Concept | Meaning |
| --- | --- |
| Installed server | A saved MCP server definition: id, name, transport, command or URL, environment, headers, and global enabled state. |
| Workspace enablement | Whether that installed server is active for a specific workspace path. |

A server's tools appear only when both are true:

1. The server is globally enabled.
2. The server is enabled for the current workspace path.

This distinction matters because most “MCP installed but tools missing” issues are workspace enablement issues.

## Default Workflow

1. Identify the workspace path. Use `pwd` for the current project unless the user names another path.
2. If the user already named a server or endpoint, configure exactly that. Do not substitute a different MCP server.
3. If the user has not named a server, ask what MCP server or source they want to add instead of recommending one.
4. Use `piagent mcp` for all install, add, enable, disable, remove, and list actions.
5. Install or add one server definition at a time.
6. Enable the server for the intended workspace.
7. Start a new agent turn or refresh runtime state so MCP tools are reloaded.
8. Verify with `piagent mcp list --workspace <path>` and, when possible, by asking the runtime to list available tools.

## CLI Commands

Run commands from the target workspace when possible.

```bash
# Inspect global server definitions and per-workspace state
piagent mcp list --workspace "$(pwd)"

# Show built-in preset ids without choosing one for the user
piagent mcp presets

# Install a user-selected preset and enable it for this workspace
piagent mcp install-preset <preset-id> --workspace "$(pwd)"

# Enable or disable an already installed server for this workspace
piagent mcp enable <server-id> --workspace "$(pwd)"
piagent mcp disable <server-id> --workspace "$(pwd)"

# Remove an installed server definition globally
piagent mcp remove <server-id>
```

For custom servers, use `piagent mcp add`.

```bash
# Local stdio server
piagent mcp add <server-id> \
  --name "<display-name>" \
  --transport stdio \
  --command <command> \
  --args '["arg-one","arg-two"]' \
  --workspace "$(pwd)"

# Remote HTTP or SSE server
piagent mcp add <server-id> \
  --name "<display-name>" \
  --transport http \
  --url <https-url> \
  --headers "<Header-Name>: <secret-or-token>" \
  --workspace "$(pwd)"
```

Use `--json` when the next step needs machine-readable output.

## Command Rules

| Task | Command |
| --- | --- |
| See available presets | `piagent mcp presets` |
| See installed servers | `piagent mcp list` |
| See workspace state | `piagent mcp list --workspace <path>` |
| Install a known preset | `piagent mcp install-preset <preset-id> --workspace <path>` |
| Add custom stdio server | `piagent mcp add <id> --transport stdio --command <command> --args '<json-array>' --workspace <path>` |
| Add custom remote server | `piagent mcp add <id> --transport http --url <https-url> --headers '<name>: <value>' --workspace <path>` |
| Enable existing server | `piagent mcp enable <id> --workspace <path>` |
| Disable existing server | `piagent mcp disable <id> --workspace <path>` |
| Remove server globally | `piagent mcp remove <id>` |

## Field Guidance

| Field | Guidance |
| --- | --- |
| `id` | Stable lowercase identifier. Use the user's requested id when provided. |
| `name` | Human-readable label shown in Settings. |
| `transport` | `stdio` for local process servers; `http` or `sse` for remote endpoints. |
| `command` | Required for `stdio`. Use only the executable, not the whole config object. |
| `args` | JSON array string when possible. Keep quoting valid. |
| `url` | Required for `http` or `sse`. Prefer HTTPS. |
| `headers` | Newline or single-line `Name: Value` pairs. Avoid exposing secrets in chat output. |
| `workspace` | The workspace path where this server should be active. |

## Safety Rules

- Do not recommend or install a server the user did not ask for.
- Do not enable multiple servers by default.
- Do not print secrets back to the user after they are supplied.
- Prefer read-only credentials when the user is configuring external systems.
- Treat every enabled MCP server as an expansion of the agent's authority.
- If a marketplace returns HTML, a security page, or an opaque error, use `piagent mcp add` with a trusted server definition instead of exposing the raw response.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Server appears installed but tools are missing | Run `piagent mcp list --workspace <path>` and verify workspace enablement. |
| Runtime lacks tools after enabling | Start a new agent turn or refresh runtime state. |
| Stdio server fails immediately | Verify the command exists and args are valid JSON or valid shell-like arguments. |
| Remote server auth fails | Verify URL, header format, token scope, and service policy. |
| Too many irrelevant tools | Disable unneeded servers for the workspace. |
| Marketplace fails | Add the known server manually with `piagent mcp add`. |

## Response Template

When guiding a user, respond with:

1. The exact `piagent mcp` command to run.
2. Whether it installs globally, enables for a workspace, or both.
3. Any required placeholder values the user must fill in.
4. A short security note if secrets, external services, or broad permissions are involved.
5. A verification command.

Example:

```text
Use the server id and endpoint you provided:
piagent mcp add <server-id> --transport http --url <https-url> --headers "Authorization: Bearer <token>" --workspace /path/to/workspace

This saves the server and enables it for that workspace. Verify with:
piagent mcp list --workspace /path/to/workspace
```
