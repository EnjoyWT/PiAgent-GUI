# Agent Plugin Resource Format

This directory owns PiAgent agent capability plugins. It is separate from IM transport plugins.
IM transport packages remain under the legacy transport plugin path and must not be loaded through
the resource resolver in this directory.

## Installable Package Roots

The installer and discovery service expect a plugin package root, not a loose component directory.
The package root must contain one of these manifest files:

```text
plugin-root/
  .piagent-agent-plugin/plugin.json
  .piagent-plugin/plugin.json
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
```

`.piagent-plugin/plugin.json` is accepted only when it is an agent plugin manifest. A PiAgent
manifest with `kind: "transport"` is routed to the IM transport domain and is not installable as an
agent plugin.

## Native PiAgent Agent Plugin

Native PiAgent agent plugins should use `.piagent-agent-plugin/plugin.json`.

```json
{
  "id": "agent-pack",
  "domain": "agent-plugin",
  "apiVersion": "1",
  "version": "0.1.0",
  "displayName": "Agent Pack",
  "description": "Adds agent skills, MCP servers, and runtime tools.",
  "components": {
    "skills": "./skills",
    "mcpServers": "./.mcp.json",
    "extensions": "./extensions/index.ts",
    "tools": "./tools/index.mjs",
    "commands": "./commands",
    "agents": "./agents",
    "hooks": "./hooks.json"
  }
}
```

Each `components` value may be a string or an array of strings. Paths are resolved relative to the
plugin root.

## Claude-Compatible Plugin

Claude plugin packages can be installed from a local package root when they contain
`.claude-plugin/plugin.json`.

```json
{
  "name": "github-review",
  "version": "0.1.0",
  "description": "Review pull requests.",
  "interface": {
    "displayName": "GitHub Review"
  }
}
```

PiAgent maps Claude packages as follows:

| Claude package path | PiAgent component | Current support                  |
| ------------------- | ----------------- | -------------------------------- |
| `./skills`          | `skills`          | loaded when the directory exists |
| `./.mcp.json`       | `mcpServers`      | parsed when explicitly enabled   |
| `./extensions`      | `extensions`      | loaded when explicitly enabled   |
| `./commands`        | `commands`        | listed as unsupported            |
| `./agents`          | `agents`          | listed as unsupported            |
| `./hooks`           | `hooks`           | listed as unsupported            |
| `./hooks.json`      | `hooks`           | listed as unsupported            |

Compatibility means PiAgent can discover the package and map supported components. It does not mean
full Claude runtime semantics. Claude commands, agents, and hooks are not executed by this slice.

## Codex-Compatible Plugin

Codex plugin packages can be discovered when they contain `.codex-plugin/plugin.json`.

```json
{
  "name": "agent-pack",
  "version": "0.1.0",
  "description": "Adds Codex-style resources.",
  "skills": "./skills",
  "mcpServers": "./.mcp.json",
  "extensions": "./extensions/index.ts",
  "tools": "./tools/index.mjs",
  "hooks": "./hooks"
}
```

`skills`, `mcpServers`, `extensions`, `tools`, and `hooks` may be strings or arrays of strings.
Skills, MCP servers, extensions, and tools are supported. Hooks are listed but not executed.

## Pi-Mono-Compatible Package

PiAgent can also discover pi-coding-agent package roots when `package.json` declares `pi.skills`
or `pi.extensions`.

```json
{
  "name": "pi-review",
  "version": "0.1.0",
  "pi": {
    "skills": ["./skills"],
    "extensions": ["./extensions/index.ts"]
  }
}
```

`pi.extensions` entries are passed through to pi-mono's extension loader when the component is
explicitly enabled.

## Resource Resolver Output

`resolveAgentPluginResources()` returns only enabled, supported runtime resources:

```ts
type ResolvedAgentPluginResources = {
  skillPaths: string[]
  mcpServers: PluginMcpServerConfig[]
  extensionPaths: string[]
  extensionFactories: ExtensionFactory[]
  tools: ToolDefinition[]
  diagnostics: AgentPluginDiagnostic[]
  signature: string
}
```

The runtime bridge consumes these values as follows:

- `skillPaths` are passed to the runtime resource loader.
- `mcpServers` are passed to the MCP runtime manager as plugin-owned extra server configs.
- `extensionPaths` and `extensionFactories` are passed to the pi-mono runtime extension loader.
- `tools` are added to the runtime tool registry under source/toolset `plugin`.
- `signature` participates in the runtime session cache key, so changing enabled plugin resources
  refreshes the session.

## MCP Server Format

Plugin MCP declarations use the standard `.mcp.json` shape:

```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["./server.js"],
      "env": {
        "GITHUB_TOKEN": "..."
      },
      "description": "GitHub MCP server"
    },
    "remote": {
      "type": "sse",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ..."
      }
    }
  }
}
```

Supported fields:

- `command`: stdio command.
- `args`: string or string array. Arrays are stored as JSON.
- `env`: object or string. Objects are stored as JSON.
- `url`: remote MCP URL. If present and no explicit `type` is set, the transport is treated as
  `sse`.
- `headers`: object or string. Objects are stored as newline-separated `Name: value` headers.
- `type` or `transport_type`: `stdio`, `sse`, or `http`.
- `description`: optional display description.

Runtime server ids are namespaced as:

```text
plugin__<sanitizedPluginId>__<sanitizedServerId>
```

## Runtime Tool Module Format

Plugin tools are loaded only from enabled `tools` components. The component must point to an ESM
module.

Accepted exports:

```ts
export const tools = [toolDefinition]
```

```ts
export default [toolDefinition]
```

```ts
export default { tools: [toolDefinition] }
```

```ts
export async function createTools({ plugin }) {
  return [toolDefinition]
}
```

Each tool must follow the runtime `ToolDefinition` contract used by `@earendil-works/pi-coding-agent`.
PiAgent namespaces tool names as:

```text
plugin__<sanitizedPluginId>__<sanitizedToolName>
```

The wrapper preserves the original tool result and adds these details:

```ts
{
  pluginId: string,
  pluginToolName: string
}
```

## Enablement Defaults

Plugin and component state is independent:

- A plugin is enabled by default unless explicitly disabled.
- `skills` components are enabled by default.
- `mcpServers`, `extensions`, `tools`, `commands`, `agents`, and `hooks` are disabled by default.
- Unsupported components are shown in management UI but cannot be enabled into the runtime.
- Disabling the plugin disables all of its components.

## Can Claude Plugins Be Installed Directly?

Yes, with limits.

You can install a local Claude plugin package root that contains `.claude-plugin/plugin.json`.
PiAgent will discover it as an agent plugin, load `./skills` if present, and expose `./.mcp.json`
as a disabled-by-default MCP component that can be enabled later.

You cannot install an arbitrary single Claude component folder by itself unless it is wrapped in a
package root with `.claude-plugin/plugin.json`. PiAgent also does not execute Claude commands,
agents, or hooks yet. Those components are surfaced as unsupported compatibility components so the
user can see that the package contains them without silently running unimplemented behavior.
