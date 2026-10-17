# Floorp integration

## Runtime

The repository is an unpacked extension. Load the root `manifest.json` from `about:debugging#/runtime/this-firefox` and use **Reload** after edits. There is no generated manifest, transpilation, frontend, or bundled runtime dependency. Do not build, package, install, restart, or operate the user's browser unless asked.

- `background.js` checks browser compatibility before starting `browser.floorpWorkspaceBars`; workspace switching is controlled by Floorp. The experiment checks `Services.appinfo.name` and rejects non-Floorp hosts before writes or UI installation. An unsupported background opens `compatibility.html` once, recorded in background localStorage without additional permissions. Browsers that block the experiment before background execution show their own installation error.
- `experiments/floorp.json` declares the API.
- `experiments/floorp.js` manages per-window Places toolbar views and the native selector with the theme-colored `icons/selector.svg` ribbon icon on `PersonalToolbar`.

## Bindings and bookmarks

`floorp.workspace-bookmarks.mapping` stores a schema version, the collection root GUID, and workspace ID → folder GUID bindings. Multiple workspaces can share a GUID. An explicit null binding uses the standard toolbar and is not automatically rebound by name.

During initial setup, folders under **Workspace Bookmarks** are matched by workspace name, and missing folders are created once for every workspace. A new folder for the active workspace receives a copy of the standard toolbar. Existing contents and user choices are preserved. Initialization is recorded per workspace so explicit deletion does not recreate a folder. Choices persist across reloads. The selector lists only collection folders; the browser toolbar itself is not selectable. Missing or invalid bindings resolve by workspace name, while explicit null bindings stay unbound. Workspace rename preserves the selected folder; deleting a workspace removes only its binding. Explicit folder deletion requires confirmation and clears every binding to the removed folder. Browser root folders cannot be deleted through the selector.

The extension updates each window's Places query instead of moving bookmarks. It directs new bookmarks to the displayed folder. Event handlers, the selector, and patched browser functions are removed on shutdown. `browser.toolbars.bookmarks.showOtherBookmarks` is set to false and remains false after shutdown.

## Development checks

- `.devcontainer/` contains a single Node development service with Git/curl for Zed. It has no browser service or exposed ports. UID/GID are 1000, user is `columbo`, HOME is `/home/columbo`, and the repository is mounted at the same absolute path as on the host.
- Run `node --test tests/unit/*.test.cjs`, `node --check background.js`, and `node --check experiments/floorp.js` through `docker compose -f .devcontainer/compose.yml exec -T dev`. No npm dependencies are needed.
- The agent checks syntax and unit behavior. The user checks native behavior by manually reloading the unpacked extension in Floorp. Do not run browser integration diagnostics or add a browser service.
- Start the development container with `docker compose -f .devcontainer/compose.yml up -d --build dev`. Connect from Zed using **Project: Open Remote → Dev Container**.
- Run release metadata tests with `python3 -m unittest discover -s tests/unit -p 'test_*.py' -v`. They use Python's standard library and mock all publishing calls.
- `scripts/package-addon.py`: explicit runtime allowlist, including LICENSE; excludes tests, local backups, and development dependencies. Do not run without a packaging request.

Native XUL appearance and Places behavior still need manual testing in Floorp. Unit tests do not establish compatibility with every Floorp version.

## Release automation

`.github/workflows/release.yml` checks pull requests and `main` using the same minimal Node container, plus Python release tests. Only successful canonical `main` runs may publish. `scripts/release.py` generates a Gecko update manifest from the packaged XPI and uses the built-in GitHub token to upload both assets to a draft before publishing it as the latest stable release. Published versions are never overwritten; bump the root manifest version for the next release. No AMO signing or browser installation is performed by this workflow.

To release an update, increase `version` in `manifest.json` using three numeric components (for example, `0.1.1`), update `CHANGELOG.md`, and merge the PR into `main`. Actions creates the `v<version>` tag and attaches the XPI and `updates.json` to the release. **Actions → Check and release → Run workflow** on `main` can retry a run; a matching draft can be resumed. An older version cannot replace a newer stable release.

The workflow uses GitHub's built-in token with `contents: write`; repository or organization policies must allow that permission. No separate hosting or personal access token is needed. `homepage_url` links to the repository, while `browser_specific_settings.gecko.update_url` points to the latest release's `updates.json`. Automatic updates require a persistent XPI installation in a profile that permits unsigned experimental extensions; temporary source loads are for development.

## Identity

Name: Floorp Bookmark Toolbar Autoswitch. Version: `0.1.1`. ID: `bookmark-toolbar-autoswitch@just-better-code`.

MIT attribution is retained in LICENSE. No browser profile is part of the extension.
