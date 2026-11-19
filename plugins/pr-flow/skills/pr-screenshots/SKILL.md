---
name: pr-screenshots
description: Take before/after screenshots or recordings of a UI change and attach them to its GitHub PR with `gh --attach`, which uploads to GitHub's attachment storage instead of the repo. Use when a PR changes UI, when asked to take, add or attach screenshots, images, GIFs or videos to a PR, for "before and after" shots, or "add screenshots to the PR".
argument-hint: [PR number or views to shoot]
---

# PR screenshots

A PR that changes UI shows before and after screenshots in its description. Repo instructions (CLAUDE.md, AGENTS.md, CONTRIBUTING) override anything here.

## 1. Check the repo's own convention

Look in CLAUDE.md, AGENTS.md, CONTRIBUTING, `scripts/` and any screenshots README for how this repo takes and hosts PR screenshots. Follow what it says. A branch the repo calls legacy is off limits, even if it still exists.

## 2. Take before and after

- **Use the repo's screenshot tooling if it has any**, such as a script that shoots Storybook stories with Playwright.
- **Otherwise run the app and drive a browser**, or use a skill the repo or your setup provides for running the app and taking screenshots.
- **Before means `main`.** Shoot it from a worktree of `origin/main`:

  ```bash
  git worktree add --detach "$(mktemp -d)" origin/main
  ```

  Run the same tooling there, or serve the app from that worktree and point the branch's tooling at it. For a small change you can instead check out main's versions of only the changed files, shoot, then restore them. Commit your work first so the restore can't lose it.
- **Make the pairs match.** Same view, viewport, theme and data. Name them so they pair up: `<view>-before.png`, `<view>-after.png`.
- **Save captures to a scratch directory**, never inside the repo.
- If the screenshot tooling needs a TLS dev cert (vite-plugin-mkcert and the like), it may ask for sudo and fail in a non-interactive session. Look for an env switch in the repo's config that skips it. Per-repo details belong in that repo's docs.

## 3. Attach to the PR

`gh` (v2.99.0 or later) uploads images and video to GitHub's attachment storage, the same place a file pasted into a comment goes. Nothing lands in the repo or on any branch.

Write the PR body with local paths where the images go, then pass the same paths to `--attach`. `gh` uploads each file and rewrites its reference to the uploaded URL:

```bash
gh pr view <PR> --json body --jq .body > /tmp/pr-body.md   # keep the existing body
# add the Screenshots section to /tmp/pr-body.md, referencing the local files
gh pr edit <PR> --body-file /tmp/pr-body.md \
  --attach /tmp/shots/audit-tab-before.png --attach /tmp/shots/audit-tab-after.png
```

```markdown
## Screenshots

| Before | After |
|---|---|
| ![Audit tab before](/tmp/shots/audit-tab-before.png) | ![Audit tab after](/tmp/shots/audit-tab-after.png) |
```

- **The paths must match.** A reference is rewritten only if it's written exactly as the path given to `--attach`. An attached file the body doesn't reference is added to the end of the body.
- **Same flags elsewhere.** `gh pr create` and `gh pr comment` take `--attach` too. Put shots in the PR body, so reviewers see them first; use a comment for shots added during review.
- **Replacing a shot** means attaching the new file and editing the body again. The old upload stays wherever else it's linked.
- **Editing the body later**, keep the `user-attachments` URLs already in it. Don't re-attach files that are already there.
- **Access.** Uploads to a private repo are visible only to people who can see the repo.
- **Limits.** PNG, JPEG, GIF, WebP and SVG up to 10 MB; MP4, MOV and WebM up to 100 MB. You need push access to the repo.
- **If `gh` has no `--attach` flag**, it's older than v2.99.0. Ask the user to upgrade it; don't fall back to committing media.
- **Legacy branches.** Older `pr-media` and `pr-assets` or `pr-assets/<topic>` branches are legacy. Merged PRs still link to them, so leave them in place, but don't add to them.

## Recordings

GIFs attach like screenshots. A video (`.mp4`, `.mov`, `.webm`) attaches the same way and plays inline: put its reference alone in its own paragraph (`![](/tmp/shots/flow.mp4)`). Inside a sentence it becomes a link instead.
