# Updating BOZZ on Windows

After the integration PRs have been merged into `main`, use the repository-root `UPDATE_BOZZ.bat`:

1. Close BOZZ and its backend/frontend terminals.
2. Open the BOZZ repository folder.
3. Double-click `UPDATE_BOZZ.bat`.
4. Review the current branch and Git status. If there are local changes, commit or back them up first; the updater intentionally stops.
5. Confirm the update. It fetches `origin/main`, switches to `main`, fast-forwards without rewriting history, then refreshes backend and frontend dependencies.
6. Double-click `START_BOZZ.bat`.

The updater never runs `git reset --hard` or `git clean`. It does not delete `data/`, `.venv/`, `frontend/node_modules/`, local databases, model registries, or local audio. Keep local datasets and model files outside the repository.

If Git reports a conflict, the updater stops. Do not force-reset your repository; make a backup and resolve the conflict before trying again. If the repository is currently on a feature branch, the updater switches to the integrated `main` only when the working tree is clean.
