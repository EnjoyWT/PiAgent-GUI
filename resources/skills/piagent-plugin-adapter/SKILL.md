---
name: piagent-plugin-adapter
description: Convert, install, uninstall, and diagnose third-party Pi plugins for PiAgent's agent-plugin extension system. Use this whenever the user asks to install a plugin from a repository or local folder, adapt Hermes/OpenClaw/Pi plugin packages, expose plugin extension capabilities or events in PiAgent, remove an installed plugin, or troubleshoot why a plugin does not appear in Settings or why its declared extension capabilities are unavailable.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# PiAgent Plugin Adapter

Adapt third-party Pi plugins to PiAgent's native agent-plugin layer. The goal is to connect plugin resources to the existing extension runner, not to rebuild a plugin system or event bus.

## What This Skill Handles

- Install an already compatible PiAgent plugin.
- Convert a local or cloned plugin package into PiAgent's `agent-plugin` format.
- Add an extension adapter that registers the plugin's declared capabilities and listens to PiAgent runtime events when needed.
- Build and copy the plugin into PiAgent's installed plugin directory.
- Remove an installed plugin after user confirmation.
- Diagnose missing plugins, unavailable declared capabilities, extension load failures, and plugin-owned service issues.

## Key Paths

```text
PiAgent repo:
<piagent-repo>

Built-in skills:
<piagent-repo>/resources/skills

Installed user plugins:
~/.config/piagent/plugins/<plugin-id>

Expected PiAgent manifest in plugin source:
<plugin-root>/.piagent-agent-plugin/plugin.json
```

## Compatibility Check

Before changing files, inspect the plugin root.

```bash
rg --files <plugin-root> | rg '(^|/)(package.json|plugin.json|SKILL.md|tsconfig.*json)$|\\.piagent-agent-plugin/plugin\\.json$|adapters/.+/index\\.(ts|js)$'
```

A plugin is directly installable only when it already has a PiAgent manifest and build output that matches it:

```text
<plugin-root>/.piagent-agent-plugin/plugin.json
<plugin-root>/dist/adapters/piagent/index.js
```

If either is missing, treat the task as a conversion.

## PiAgent Manifest Shape

Create or update `.piagent-agent-plugin/plugin.json` with this shape:

```json
{
  "id": "plugin-id",
  "domain": "agent-plugin",
  "apiVersion": "1",
  "version": "0.0.0",
  "displayName": "Plugin Name",
  "description": "Short user-facing description.",
  "interface": {
    "viewerUrl": "http://127.0.0.1:<port>",
    "viewerLabel": "Open Plugin UI"
  },
  "components": {
    "extensions": "./dist/adapters/piagent/index.js"
  }
}
```

Rules:

- Keep `domain` as `agent-plugin`.
- Keep `components.extensions` pointed at compiled JavaScript under `dist`.
- Add `interface.viewerUrl` only if the plugin owns a local UI or service.
- Do not invent plugin IDs. Prefer the package name after normalizing it to a stable slug.
- If the plugin has no extension runtime, do not fake one. Explain that a PiAgent adapter must be added first.

## Conversion Workflow

1. Identify the source type:
   - PiAgent native plugin: has `.piagent-agent-plugin/plugin.json`.
   - Pi/Hermes/OpenClaw plugin: has an existing adapter or plugin entry but not PiAgent manifest.
   - Generic package: no compatible plugin metadata; requires a custom adapter.

2. Inspect existing runtime APIs:
   - Look for host adapters under `adapters/`, `src/adapters/`, `packages/`, or `server/`.
   - Look for declared tools, event listeners, local HTTP/API services, persistent stores, and build scripts.
   - Prefer reusing existing host-neutral core APIs.

3. Add a PiAgent adapter:
   - Create `adapters/piagent/index.ts`.
   - Export a default extension function consumed by PiAgent's extension runner.
   - Register tools through the extension API only when the plugin actually exposes tools.
   - Subscribe to PiAgent events only when the plugin needs them.
   - Start long-lived local services from a shared singleton so sessions do not create duplicates.

4. Add adapter support files only when needed:
   - `adapters/piagent/tools.ts` for tool definitions and handlers.
   - `adapters/piagent/bridge.ts` for event translation.
   - `adapters/piagent/piagent-api.ts` for local TypeScript interfaces if the plugin cannot import PiAgent types.
   - `adapters/piagent/README.md` for operator notes.

5. Wire the build:
   - Ensure `tsconfig.json` or the package build includes `adapters/piagent/**/*.ts`.
   - Ensure package `files` or publish config includes `.piagent-agent-plugin`, `dist`, and adapter assets.
   - Run the package's existing build command. Do not replace the build system unless necessary.

6. Install to PiAgent:
   - Copy the built plugin into `~/.config/piagent/plugins/<plugin-id>`.
   - Preserve runtime assets, `package.json`, lockfiles, manifest, and `dist`.
   - Exclude `.git`, source caches, and unrelated build artifacts.
   - Install production dependencies in the installed plugin directory when the adapter imports package dependencies at runtime.

## Extension Adapter Pattern

Use the plugin's real APIs; do not hard-code behavior only to satisfy discovery. The example below is for a plugin that exposes tools and listens to runtime events; omit the parts the target plugin does not support.

```ts
export default function pluginExtension(pi: PiAgentExtensionApi): void {
  registerPluginTools(pi, {
    getRuntime: async () => getSharedRuntime(),
  });

  pi.on("before_agent_start", async (event, ctx) => {
    return (await getSharedRuntime()).bridge.handleBeforeAgentStart(event, ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    await (await getSharedRuntime()).bridge.handleAgentEnd(event, ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    await (await getSharedRuntime()).bridge.handleToolResult(event, ctx);
  });
}
```

For local services, use a process-wide singleton:

```ts
const RUNTIME_KEY = Symbol.for("plugin-id.piagent.runtime");
```

This prevents a background extension and an agent session from starting duplicate servers.

## Install Commands

Use the package manager already used by the plugin.

```bash
# From the plugin source
pnpm install
pnpm run build

# Install into PiAgent
mkdir -p ~/.config/piagent/plugins/<plugin-id>
rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  <plugin-root>/ ~/.config/piagent/plugins/<plugin-id>/

# From the installed plugin, install runtime dependencies if needed
cd ~/.config/piagent/plugins/<plugin-id>
npm ci --omit=dev
```

If the package uses `pnpm-lock.yaml` and the installed runtime can resolve pnpm layout, use `pnpm install --prod` instead of `npm ci --omit=dev`.

## Uninstall Workflow

Only uninstall after the user confirms the target plugin ID.

```bash
ls ~/.config/piagent/plugins
rm -rf ~/.config/piagent/plugins/<plugin-id>
```

If PiAgent is running, ask the user to disable the plugin in Settings first when possible, then remove the directory and restart PiAgent.

## Diagnostics

Use this checklist when the plugin does not appear, does not enable, or a capability declared by the plugin is unavailable.

1. Manifest exists and is valid JSON:

```bash
node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")))' \
  ~/.config/piagent/plugins/<plugin-id>/.piagent-agent-plugin/plugin.json
```

2. `components.extensions` points to an existing compiled JS file:

```bash
test -f ~/.config/piagent/plugins/<plugin-id>/dist/adapters/piagent/index.js
```

3. Runtime dependencies are installed in the installed plugin directory.

4. PiAgent has been restarted after install, rebuild, or config changes.

5. The plugin and its `extensions` component are enabled in Settings.

6. If the plugin declares tools, tool discovery sees those plugin tools. Ask the model to run tool discovery or use the app's built-in tool list if available.

7. If the plugin owns a local viewer or HTTP/API service, verify the configured port from its manifest or config:

```bash
curl -I http://127.0.0.1:<port>/
lsof -nP -iTCP:<port> -sTCP:LISTEN
```

8. For extension load errors, inspect the main process log and check:
   - ESM/CJS mismatch.
   - Missing runtime dependency.
   - Wrong `dist` path.
   - Adapter default export is missing or not a function.
   - Adapter imports source TypeScript instead of compiled JavaScript.

## MemOS Reference Pattern

MemOS-style adapters should follow this shape:

```text
.piagent-agent-plugin/plugin.json
adapters/piagent/index.ts
adapters/piagent/tools.ts
adapters/piagent/bridge.ts
adapters/piagent/piagent-api.ts
dist/adapters/piagent/index.js
```

For memory plugins, expose retrieval tools so the model can query the memory layer directly. Typical tool names:

```text
memos_search
memos_get
memos_timeline
memos_environment
memos_skill_list
memos_skill_get
```

## Safety Rules

- Do not delete plugin directories without explicit confirmation.
- Do not expose or print API keys from plugin config files.
- Do not change PiAgent runtime code unless conversion cannot work through an adapter.
- Do not create a second plugin/event system inside the plugin.
- Keep adapter changes scoped to the plugin package whenever possible.
- After making code changes in the PiAgent repo, run the repo's normal typecheck or targeted tests.
