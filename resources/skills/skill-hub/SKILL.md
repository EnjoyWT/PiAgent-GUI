---
name: skill-hub
description: Search, install, list, uninstall, and update PiAgent skills. Use when the user needs a capability PiAgent does not have yet, or when you encounter a task that would benefit from a specialized skill.
allowed-tools:
  - Bash
  - Read
  - Write
---

# Skill Hub

Discover, install, and manage skills from the skills.sh ecosystem to extend PiAgent's capabilities.

## Search for Skills

```bash
# Search the skills.sh registry
piagent skills search <query>

# Examples
piagent skills search weather
piagent skills search email
piagent skills search calendar
```

## Install a Skill

```bash
# Install a specific skill from skills.sh
piagent skills install <owner/repo@skill-name>

# Install from a skills.sh skill page URL
piagent skills install <https://skills.sh/owner/repo/skill-name>

# Install an entire skill bundle by source
piagent skills install <source>

# Install a specific branch
piagent skills install <source> --ref <branch>

# Select one skill from a bundle explicitly
piagent skills install <source> --skill <skill-name>

# Replace an existing installed skill bundle
piagent skills install <source> --force

# Install into a custom skills directory
piagent skills install <source> --target <dir>
```

## List Installed Skills

```bash
piagent skills list
```

## Uninstall a Skill

```bash
piagent skills uninstall <skill-name>
```

## Update Skills

```bash
# Update all skills previously installed through piagent skills install
piagent skills update

# Update one or more managed skills by name
piagent skills update <skill-name> [another-skill-name]
```

## When to Use

- User asks you to do something PiAgent cannot do well with current tools or skills
- You encounter a task that would benefit from a specialized skill
- User explicitly asks to find, install, remove, or refresh capabilities
- Be proactive: if a task stalls because you lack a capability, search for a skill before giving up

## Self-Evolution Flow

1. User asks for a capability you do not currently have.
2. Search first with `piagent skills search <query>`.
3. Install the best match with `piagent skills install <source>`.
4. Continue the task with the new skill when available.
5. Keep the skill installed so future turns can reuse it.

## Create a Custom Skill

```bash
mkdir -p ~/.config/piagent/skills/my-skill
cat > ~/.config/piagent/skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: What this skill does
allowed-tools:
  - Bash
  - Read
---

# My Skill

Instructions for the AI on how to use this skill...
EOF
```

## Tips

- PiAgent's bundled and app-local skills live in `~/.config/piagent/skills/`.
- Skills installed from `skills.sh` default to the shared directory `~/.agents/skills/` unless `--target` is specified.
- `piagent skills search` queries the official `skills.sh` search index.
- Search results are installable as `owner/repo@skill-name`.
- `piagent skills update` only works for skills installed through `piagent skills install`, because PiAgent records their install source for later refresh.
- `piagent skills uninstall` can remove managed, bundled, or manual skills from the selected target directory.
- Do not manually edit unrelated installed skills during install or update flows.
- After installing a skill, it's available in the current conversation turn
- **Don't give up on the first failure** — search for skills, install them, and try again
