# Settings Layout Notes

This file records layout pitfalls that are easy to reintroduce in the settings window.

## Horizontal Scroll Regression: PluginsSettings

### Symptom

The settings content area showed horizontal scrolling in the plugins page, while the scheduled tasks page did not.

### Root Cause

The issue was caused by a `flex` min-width chain, not by a missing `overflow-x-hidden`.

Problem pattern:

- Long single-line text used `truncate`.
- The same row also contained `shrink-0` badges and action buttons.
- One or more ancestor `flex` items still used the default `min-width: auto`.
- That allowed the long text's min-content width to expand the entire right-side settings content area.

In this case, the critical containers were:

- `src/renderer/src/windows/settings/SettingsWindow.vue`
- `src/renderer/src/windows/settings/components/PluginsSettings.vue`

The fix was to add `min-w-0` along the shrinking path so the text could actually truncate instead of increasing parent width.

### Why ScheduledTasksSettings Did Not Break

`ScheduledTasksSettings.vue` uses a similar card layout, but its content is less likely to create a large horizontal minimum width:

- Fewer fixed-width elements compete in the same row.
- More metadata is pushed into a lower grid row instead of the header row.
- The main title row is structurally simpler.

## Rule: `truncate` Is Not Enough

If a child uses `truncate`, check every ancestor in the horizontal `flex` chain.

If the text should shrink, the relevant `flex` items usually need `min-w-0`.

Typical high-risk pattern:

- A long title or description.
- Badges with `shrink-0`.
- Buttons with `shrink-0`.
- Parent row uses `display: flex`.

## What To Check Before Shipping A New Settings Panel

When building or editing a settings component:

1. Any row with long text inside `flex` should be reviewed for `min-w-0`.
2. Any text block using `truncate` should have a shrinkable ancestor chain.
3. Any `shrink-0` badge/button next to long text increases overflow risk.
4. The right-side main content container in `SettingsWindow.vue` must stay shrinkable.
5. Do not "fix" this class of issue by only hiding overflow. That masks the symptom and keeps layout width wrong.

## Practical Debugging Steps

If horizontal scroll appears again:

1. Inspect the element that visually overflows.
2. Walk upward through parent nodes.
3. Find the first ancestor whose rendered width is larger than the visible content area.
4. Check whether that ancestor or its `flex` parents are still using the default `min-width: auto`.
5. Add `min-w-0` to the shrink path instead of adding blind clipping.

## Safe Default For Settings UI

For settings cards and rows, prefer this mindset:

- Outer content columns: allow shrinking with `min-w-0`.
- Card list containers: allow shrinking with `min-w-0`.
- Rows mixing text and controls: allow the text side to shrink with `min-w-0`.
- Fixed controls: keep `shrink-0` only where the control really must preserve width.

## Files Touched In The Original Fix

- `src/renderer/src/windows/settings/SettingsWindow.vue`
- `src/renderer/src/windows/settings/components/PluginsSettings.vue`
