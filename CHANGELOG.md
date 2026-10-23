# Changelog

## 0.2.2

- Apply the active workspace's container to the toolbar context menu's Open in New Tab and Open All in Tabs commands. Reattach context command hooks when the native toolbar view is rebuilt, and restore them on shutdown.

## 0.2.1

- Use the active workspace's container when toolbar bookmarks create tabs, including middle-clicks, while preserving native opening preferences and explicit container choices.
- Keep toolbar initialization independent of optional native opening hooks. If a hook is unavailable or cannot be replaced, restore any partially installed wrappers and continue displaying workspace bookmarks.

## 0.2.0

- Retry workspace and native bookmark view initialization every second until ready, applying the current toolbar after a browser restart without a workspace click.
- Archive standard toolbar contents once under Workspace Bookmarks, preserving originals and nested folders while leaving the base toolbar empty. Interrupted transfers resume without duplicate backups; manual restoration remains possible.

## 0.1.2

- Make the extension icon square with minimal transparent margins, preserving the artwork and its proportions.

## 0.1.1

- Use the selected workspace/bookmark icon with tightly cropped transparent margins.
- Document installation from GitHub Releases and link the repository in extension details.
- Use the `bookmark-toolbar-autoswitch@just-better-code` extension ID.

## 0.1.0 — development

- GitHub Actions checks, versioned XPI releases, and a GitHub-hosted automatic update feed.
- Floorp-first branding and an unsupported-browser notice; Firefox startup is blocked before changes.
- Standalone unpacked Floorp extension with no compilation step.
- Automatic per-window bookmark toolbar selection by workspace.
- Shared folder bindings and a native toolbar selector.
- Initial folder matching by workspace name and persistent manual choices.
- Confirmed manual folder deletion; no automatic bookmark deletion on workspace removal.

Inspired by Kapcash/bookmark-switcher; the original MIT notice is retained in LICENSE.
