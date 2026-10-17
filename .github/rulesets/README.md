# Protecting main

These JSON files are import templates. Committing them does **not** activate GitHub repository rules. `.github/CODEOWNERS` assigns `@just-better-code` to all files, including GitHub configuration.

After the workflow and CODEOWNERS have landed on `main` and the `check` job has completed:

1. Open **Settings → Rules → Rulesets → New ruleset → Import a ruleset**.
2. Import `main-safety.json`, review it, and click **Create** with enforcement **Active**.
3. Repeat for `main-owner.json`. Verify its bypass actor is **just-better-code**, with mode **For pull requests only**.
4. Keep both rulesets active. If GitHub does not accept the user bypass from the imported JSON, select **just-better-code** explicitly in the UI before saving. Do not substitute a broader collaborator or administrator role.

The safety ruleset has no bypass: all changes, including the owner's, must go through a PR, pass the `check` job against current `main`, and resolve review conversations. Force pushes and branch deletion are blocked.

The ownership ruleset restricts branch updates to the owner through PRs. It requires code-owner review for other actors and gives only `@just-better-code` (GitHub user ID `28658210`) a PR-only bypass. This lets the owner merge their own PRs without trying to approve themselves, while the separate safety ruleset still enforces PRs and checks. Other collaborators cannot merge, even after an approving review. The owner may need to select GitHub's explicit bypass option when merging.

No bypass is granted to GitHub Actions. Releases create tags and upload assets; the workflow does not push to `main`.

Check GitHub's Rules page after import. As a collaborator, direct pushes and merges must be blocked; as the owner, a PR with a failing check must still be blocked. The owner retains the administrative ability to edit repository rules.
