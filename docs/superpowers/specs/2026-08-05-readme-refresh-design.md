# README Refresh Design

## Goal

Make the repository homepage read like a professional Chinese-first open-source
project: communicate value quickly, provide a reliable first-run path, and keep
implementation detail discoverable without turning the README into a manual.

## Structure

1. Product title, one-sentence positioning, and concise project description.
2. Screenshots followed by a capability overview grouped by user outcome.
3. Quick start: prerequisites, install, development, verification, and release
   build commands.
4. Configuration and extension overview: model providers, MCP, plugins, Skills,
   IM, memory, and scheduled tasks.
5. Architecture map, development status, contribution entry points, and license.
6. Sources and acknowledgements as the final section.

## Content Rules

- Chinese is the primary language; technical names stay in English where they
  are product or protocol names.
- State only verified capabilities and current constraints.
- Remove the obsolete claim that UI event ordering is known to be unstable.
- Do not list every internal tool or implementation directory; link readers to
  source locations and use grouped summaries instead.
- Preserve attribution to AlMA, pi-mono, OpenClaw/Hermes, Memos, and the broader
  MCP/plugin ecosystem, but place it after the license.
