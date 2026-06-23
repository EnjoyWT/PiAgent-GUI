# E2E Test Architecture

This directory contains the Electron end-to-end test framework for PiAgent.

## Principles

- Tests run against the real built Electron app, not a browser-only renderer page.
- Each test gets an isolated `userData` directory and workspace root under Playwright's per-test output folder.
- Test code lives entirely under `tests/e2e`; production code only exposes stable selectors and startup isolation hooks.
- Test data is seeded through the app's existing `window.api.db.*` preload surface, so the exercised path stays close to production.

## Layout

- `playwright.config.ts`: Playwright runner configuration for Electron E2E.
- `fixtures/`: app lifecycle and shared Playwright fixtures.
- `pages/`: page objects for stable UI interactions.
- `support/`: isolated runtime paths and data seeding helpers.
- `specs/`: scenario tests.

## Current Coverage

- Chat history pagination defaults to the latest 50 visible messages.
- The production preload API returns subsequent history windows without duplicates.
- Streaming output keeps following the bottom when the user stays pinned to the bottom.
- Streaming output stops auto-scrolling when the user has manually scrolled up.

## Commands

- `npm run test:e2e`
- `npm run test:e2e:headed`
- `npm run test:e2e:debug`
- `npm run test:e2e:ui`
