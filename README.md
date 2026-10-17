# Floorp Bookmark Toolbar Autoswitch

Automatically display the bookmark toolbar assigned to the current Floorp workspace. Multiple workspaces can share the same toolbar.

**Floorp only. Firefox and other browsers are not supported.** If the background script can run in an unsupported browser, the extension opens a compatibility notice once and stops before changing bookmarks or browser settings. If the browser blocks the experimental extension from loading, it displays its own installation error instead.

## Installation

1. Download the `.xpi` file from the [latest GitHub Release](https://github.com/just-better-code/floorp-workspace-bookmark-switcher/releases/latest), under **Assets**.
2. In Floorp, open **Add-ons and Themes** (`about:addons`).
3. Open the gear menu, choose **Install Add-on From File…**, and select the downloaded `.xpi`.

This is an unsigned extension using privileged experimental APIs. Your Floorp profile must permit unsigned experimental extensions, including `extensions.experiments.enabled=true`. Publishing an XPI on GitHub does not provide a Mozilla signature.

Extension ID: `bookmark-toolbar-autoswitch@just-better-code`.

## Usage

- Open the bookmark ribbon button at the right end of the bookmarks toolbar. Its tooltip is **Choose a bookmark toolbar for the current workspace**.
- Click **+** below the list to enter a toolbar name, then click the green checkmark or press **Enter** to create it. Press **Escape** to cancel. New toolbars are empty; select the checkbox to assign one to the current workspace. Blank and duplicate names are rejected.
- The **Copy** icon selects a source toolbar. **Paste** in another row appends copies of its bookmarks and nested folders, preserving existing contents and originals. A toolbar cannot be pasted into itself. The source selection resets after pasting or reopening the menu.
- Workspace icons before **Copy** show which workspaces use each toolbar. Hover to see their names; the current workspace has a highlighted background. If a Floorp icon is unavailable, the first letter of the workspace name is shown instead.
- Select a toolbar's checkbox to assign it to the current workspace. Each workspace has one selected toolbar; a toolbar can serve multiple workspaces.
- Click the **Rename** pencil between Copy and Delete to edit a toolbar's name. The green checkmark or **Enter** saves; **Escape** cancels. Bookmarks and workspace assignments are preserved. Blank and duplicate names are rejected.
- Toolbars are stored as folders under **Bookmarks Menu → Workspace Bookmarks**. You can also add folders there using the bookmarks manager.
- During initial setup, the extension matches folders by workspace name and creates missing ones. A newly created folder for the active workspace receives a copy of the standard toolbar; originals stay in place. Existing folders and manual assignments are preserved. Folders deleted through the extension are not automatically recreated.
- An unassigned workspace displays the standard bookmarks toolbar. **Ctrl+D** saves to the folder displayed in the active window.
- Renaming or deleting a workspace does not rename or delete its bookmark folder.
- **×** deletes a folder and its bookmarks after confirmation, clearing every workspace assignment to it.

Switching workspaces changes the toolbar view without moving or copying bookmarks. Different windows can display different folders. The extension hides **Other Bookmarks** using Floorp's built-in preference; that preference remains disabled after the extension is turned off.

## Automatic updates

After installation, Floorp can check for updates through the extension's GitHub-hosted update feed. It downloads new versions from GitHub Releases and verifies their SHA-256 hashes. Keep automatic updates enabled for the extension in **Add-ons and Themes**.

The repository link in the extension's details opens this project. Updates use a separate `update_url` pointing to the latest release's `updates.json`; they are not distributed through AMO.

## Contributing

Submit changes through pull requests. `@just-better-code` owns all files, including workflows and repository configuration. The [branch protection templates](.github/rulesets/README.md) require explicit import in GitHub Settings; files alone do not activate protection. Once enabled, `main` accepts only PR merges by the owner with passing checks. Direct pushes are blocked, including for the owner.

See [FLOORP-DEVELOPMENT.md](FLOORP-DEVELOPMENT.md) for source loading, the minimal development container, tests, and release instructions. The extension has no runtime dependencies or compilation step.

## License and inspiration

Released under the MIT license. Inspired by [Kapcash/bookmark-switcher](https://github.com/Kapcash/bookmark-switcher); the current implementation provides Floorp workspace integration and a native toolbar selector. The original copyright and license notice are retained in [LICENSE](LICENSE).
