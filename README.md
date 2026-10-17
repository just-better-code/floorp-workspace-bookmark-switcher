# Floorp Bookmark Toolbar Autoswitch

Automatically display the bookmark toolbar assigned to the current Floorp workspace. Multiple workspaces can share the same toolbar.

**Floorp only. Firefox and other browsers are not supported.** If the background script can run in an unsupported browser, the extension opens a compatibility notice once and stops before changing bookmarks or browser settings. If the browser blocks the experimental extension from loading, it displays its own installation error instead.

## Load from a folder

1. In Floorp, open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select **`manifest.json` in the repository root**.
3. After editing the source, click **Reload** on the extension card. No compilation or XPI packaging is required.

The extension uses privileged experimental APIs. The profile must allow them (`extensions.experiments.enabled=true`). A temporary installation lasts until the browser restarts.

Extension ID: `bookmark-toolbar-autoswitch@columbo`.

## Usage

- Open the bookmark ribbon button at the right end of the bookmarks toolbar. Its tooltip is **Choose a bookmark toolbar for the current workspace**.
- Click **+** below the list to enter a toolbar name, then click the green checkmark or press **Enter** to create it. Press **Escape** to cancel. New toolbars are empty; select the checkbox to assign one to the current workspace. Blank and duplicate names are rejected.
- The **Copy** icon selects a source toolbar. **Paste** in another row appends copies of its bookmarks and nested folders, preserving existing contents and originals. A toolbar cannot be pasted into itself. The source selection resets after pasting or reopening the menu.
- Workspace icons before **Copy** show which workspaces use each toolbar. Hover to see their names; the current workspace has a highlighted background. If a Floorp icon is unavailable, the first letter of the workspace name is shown instead.
- Select a toolbar's checkbox to assign it to the current workspace. Each workspace has one selected toolbar; a toolbar can serve multiple workspaces.
- Toolbars are stored as folders under **Bookmarks Menu → Workspace Bookmarks**. You can also add folders there using the bookmarks manager.
- During initial setup, the extension matches folders by workspace name and creates missing ones. A newly created folder for the active workspace receives a copy of the standard toolbar; originals stay in place. Existing folders and manual assignments are preserved. Folders deleted through the extension are not automatically recreated.
- An unassigned workspace displays the standard bookmarks toolbar. **Ctrl+D** saves to the folder displayed in the active window.
- Renaming or deleting a workspace does not rename or delete its bookmark folder.
- **×** deletes a folder and its bookmarks after confirmation, clearing every workspace assignment to it.

Switching workspaces changes the toolbar view without moving or copying bookmarks. Different windows can display different folders. The extension hides **Other Bookmarks** using Floorp's built-in preference; that preference remains disabled after the extension is turned off.

## Development and checks

`manifest.json` is the canonical manifest; `background.js` checks compatibility and starts the API. `experiments/` contains the privileged integration and API schema; `icons/` contains runtime icons. See [FLOORP-DEVELOPMENT.md](FLOORP-DEVELOPMENT.md) for implementation details.

The extension has no runtime dependencies or compilation step. `.devcontainer/` provides a minimal environment for Zed and checks: container `bookmark-toolbar-autoswitch-dev`, user `columbo`, HOME `/home/columbo`. The project path inside the container matches the host path. Connect from Zed using **Project: Open Remote → Dev Container**.

```sh
docker compose -f .devcontainer/compose.yml up -d --build dev
docker compose -f .devcontainer/compose.yml exec -T dev node --test tests/unit/*.test.cjs
docker compose -f .devcontainer/compose.yml exec -T dev node --check background.js
docker compose -f .devcontainer/compose.yml exec -T dev node --check experiments/floorp.js
```

Run Node.js checks inside the development container. Native browser behavior is checked manually in Floorp using **Reload** and the [manual checklist](tests/integration/README.md). There is no browser container or automatic installation.

When a package is needed, `python3 scripts/package-addon.py` creates `dist/bookmark-toolbar-autoswitch-<version>.xpi` directly from the runtime sources. Packaging and installation are explicit steps, separate from source checks.

## Releases and automatic updates

GitHub Actions runs checks for pull requests and pushes to `main`. After successful checks on `main`, it packages the version from `manifest.json`, creates a matching `v<version>` tag, and publishes a GitHub Release containing the XPI and `updates.json`. You can also run **Actions → Check and release → Run workflow** on `main`.

To release an update, increase `version` in `manifest.json`, update `CHANGELOG.md`, and push to `main`. Use three numeric components, such as `0.1.1`. An already published version is left unchanged; changes require a new version. Both assets are uploaded to a draft before publication, and an older version cannot replace a newer stable release.

The extension's `update_url` points to the latest release's `updates.json`. Floorp reads this file to discover the versioned XPI and verify its SHA-256 hash. Updates are hosted on GitHub, not AMO. No separate hosting or personal access token is needed; the release job uses GitHub's built-in token with `contents: write` permission. Repository or organization policies must allow that permission.

Automatic updates apply to a persistent XPI installation in a Floorp profile that permits this unsigned experimental extension. Temporary `about:debugging` installations remain a source development workflow. The update feed does not provide Mozilla signing or bypass the browser's installation requirements.

Release metadata tests use Python's standard library:

```sh
python3 -m unittest discover -s tests/unit -p 'test_*.py' -v
```

## Contributing

Submit changes through pull requests. `@just-better-code` owns all files, including workflows and repository configuration. The [branch protection templates](.github/rulesets/README.md) require explicit import in GitHub Settings; files alone do not activate protection. Once enabled, `main` accepts only PR merges by the owner with passing checks. Direct pushes are blocked, including for the owner.

## License and inspiration

Released under the MIT license. Inspired by [Kapcash/bookmark-switcher](https://github.com/Kapcash/bookmark-switcher); the current implementation provides Floorp workspace integration and a native toolbar selector. The original copyright and license notice are retained in [LICENSE](LICENSE).
