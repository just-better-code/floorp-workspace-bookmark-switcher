# Manual browser checks

The user runs these checks in Floorp with disposable bookmarks. The agent runs only syntax and unit checks in the development container; no browser automation is required.

1. Load the root manifest and confirm the selector appears on the bookmarks toolbar.
2. Check initial folder matching and creation with at least two differently named workspaces. Before setup, put disposable bookmarks, nested folders, and separators on the standard toolbar. Confirm originals move into **Workspace Bookmarks → Original Bookmarks Toolbar**, the standard toolbar becomes empty, and the active workspace retains its initial copy. Existing workspace contents and assignments must remain intact.
3. Bind both workspaces to one toolbar, then give each a different toolbar. Switch workspaces and verify the displayed bookmarks.
4. Open a second window with a different workspace and verify that each window displays its own toolbar. Check the destination of a new bookmark in each active window.
5. Create and rename a toolbar using the green checkmark or Enter; cancel with Escape. Check blank and duplicate names. Renaming a shared toolbar must preserve its bookmarks and all workspace assignments.
6. Copy nested folders and bookmarks to a nonempty toolbar. Verify originals remain, existing contents remain, and self-copy is unavailable.
7. Delete a shared test toolbar after confirming. Verify all its bindings are cleared. Delete or rename a workspace and verify its bookmarks remain.
8. Restart Floorp with a nonempty workspace toolbar selected. Without clicking tabs or workspaces, verify its bookmarks appear automatically and the empty-toolbar hint disappears. Repeat with two windows using different workspaces. Reload, disable, and re-enable the extension. Check persisted bindings, selector cleanup, and restoration of the standard toolbar when disabled.
9. Restore some archived items to the standard toolbar using the bookmarks manager, then reload. Verify they stay there; renaming or deleting the backup must not trigger another transfer. Test an initially empty standard toolbar and a preexisting folder named **Original Bookmarks Toolbar** as well.
10. Check hover and keyboard focus, icon tooltips, long names, and light/dark themes.
11. In an unsupported browser where the background can run, verify the compatibility notice and absence of bookmark or preference changes. If the browser rejects the experiment first, verify its installation error instead.
