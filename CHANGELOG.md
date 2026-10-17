# Changelog

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
