# Repository Guidelines

## Project Structure & Module Organization

This repository is an unpacked Floorp extension. `manifest.json` at the repository root is the canonical manifest; `background.js` starts the workspace API. `experiments/floorp.js` contains privileged Places integration and the native toolbar selector; `experiments/floorp.json` declares its API. Icons live in `icons/`.

Unit tests live in `tests/unit/`; the manual browser checklist lives in `tests/integration/README.md`. `scripts/package-addon.py` packages an explicit runtime file list. Read `FLOORP-DEVELOPMENT.md` for architecture and configuration. Preserve upstream MIT attribution in `LICENSE`.

## Development Commands

- Load the root `manifest.json` through `about:debugging#/runtime/this-firefox`; use **Reload** after source edits. No compilation is required.
- `.devcontainer/` defines the single minimal development container and Zed connection. The project path and `/home/columbo` HOME match the host paths.
- `docker compose -f .devcontainer/compose.yml exec -T dev node --test tests/unit/*.test.cjs`: run standard-library unit tests.
- Run `node --check background.js` and `node --check experiments/floorp.js` through the same container for syntax checks.
- `python3 scripts/package-addon.py`: package sources into `dist/`; run only when requested.

Never build, package, install, restart, or control the user's browser without authorization. Changes to source files are sufficient for the user's manual reload workflow.

## Coding Style & Naming Conventions

Use plain JavaScript with two-space indentation and single quotes; follow surrounding code. No framework, bundler, polyfill, or package manager is needed. Use Node.js only inside the minimal dev-container. Do not restore host Node.js/npm, install npm packages, add browser/Selenium services, or automate browser behavior. The agent checks syntax and units; the user verifies behavior in Floorp. Keep privileged browser operations inside the experiment API. Update its JSON schema when public interfaces change.

## Testing Guidelines

Use `*.test.cjs` for Node tests. Test shared bindings, persistence, deletion, per-workspace selection, and cleanup without changing the user's bookmarks. The user performs browser checks manually; use disposable bookmarks for destructive scenarios. Unit tests do not replace native Floorp verification.

## Commit & Pull Request Guidelines

Use concise, imperative, type-prefixed commits such as `fix: preserve shared folder bindings`. Describe behavior changes and validation in PRs; include screenshots for native UI changes. Call out permission, preference, and bookmark-storage changes explicitly.
