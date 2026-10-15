# Synq Git collaboration

- Before changing code, inspect the current branch, working tree, remotes, and recent history. Preserve existing staged, unstaged, deleted, and untracked work.
- Fetch remote updates before starting work when network access is available. Fetching must not be treated as permission to merge or overwrite local changes.
- Use a feature branch for substantial work or parallel contributors. Keep each branch focused and do not assume another contributor's changes are disposable.
- Review conflicts manually; never resolve them by blindly taking one side or resetting files.
- Run the relevant lint, type-check, build, and tests available in `package.json` before committing. Do not change application behavior solely to silence checks.
- Keep `.env*` files, OAuth client downloads, API keys, service-role keys, access tokens, and other credentials out of Git. Use server-side secrets for privileged credentials.
- Commit only coherent, reviewed, completed changes with descriptive messages. Check the staged diff and scan for secrets before committing.
- Push completed work when the user has requested it and repository authentication and permissions allow. Never force-push, reset shared branches, or rewrite shared history without explicit authorization.
- At the end of each task, report the branch, commit, push status, checks run, and any remaining conflicts or blockers.
