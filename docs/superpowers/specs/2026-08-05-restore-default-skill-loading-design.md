# Restore Default Skill Loading Design

## Goal

Restore pi-mono's normal Skill loading behavior: all Skills enabled by the existing configuration are listed in the model's system prompt, while full `SKILL.md` content remains on-demand through `readSkillTool`.

## Scope

- Preserve the existing `skills_disabled` configuration as the sole enablement decision.
- Keep pi-mono's normal Skill formatter behavior for each enabled Skill (`name`, `description`, and location metadata).
- Keep `readSkillTool` available so the model can load full instructions after selecting a listed Skill.
- Keep the on-demand tool schema architecture unchanged.
- Remove the private per-conversation Skill catalog and the redundant `skillSearch` runtime tool.

## Data flow

1. `DefaultResourceLoader` discovers Skill files through the existing configured paths.
2. `skillsOverride` marks only names in `skills_disabled` as `disableModelInvocation`.
3. pi-mono formats every remaining enabled Skill into its normal system-prompt Skill directory.
4. The model selects an advertised Skill and calls `readSkillTool` to load its full contents.

## Error handling and lifecycle

- Malformed `skills_disabled` JSON continues to be ignored, leaving Skills enabled as before.
- Disabled Skills are excluded both from the prompt directory and from `readSkillTool`.
- No per-conversation Skill state remains to clear on stop, restart, cancellation, or deletion.

## Verification

- A loader test proves enabled Skills remain model-invocable and disabled Skills do not.
- Registry tests prove `skillSearch` is absent while `readSkillTool` remains core.
- Existing `readSkillTool` tests continue to prove full bodies are read only on demand.
- Typecheck, renderer logic tests, focused runtime tests, and production build pass.
