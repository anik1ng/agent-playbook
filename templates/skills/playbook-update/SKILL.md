---
name: playbook-update
description: Sync this repository against the current agent-playbook — read the lock, fetch the playbook, report what moved upstream, then follow UPDATE.md to land the sync as one PR. Use when asked to update, sync or check the playbook, whichever tool you are.
---

You are syncing this repository against the agent-playbook it was adopted from.

**`UPDATE.md` in the playbook repository is canonical** — it defines the sync (the two
file classes, the report form, the verification discipline) and this file only starts it
and adds the lock mechanics. Where the two disagree, UPDATE.md wins and this file is the
bug.

## 1. Read the lock

    cat .agents/playbook.lock

The `commit` line is the playbook commit this repo was last synced to. The optional
`docs` lines are word-count baselines written by `/playbook-compact` — used in step 5,
never a reason to stop.

No lock file → this repo was adopted before locks existed. Not an error: run the FULL
UPDATE.md pass and write the lock as part of the sync PR (step 6) — or, if the pass finds
nothing to sync, as its own one-file `chore` PR so the next run gets the fast path.

## 2. Fetch the playbook — with history

    git clone https://github.com/anik1ng/agent-playbook <tmpdir>

NOT `--depth 1` when a lock exists: the delta below needs `git log`, and the repo is
small. Always a fresh clone, never a stale copy.

## 3. Fast path

    git -C <tmpdir> rev-parse origin/master

If it equals the lock's `commit`: report "up to date at `<sha>`", give the doc-size
report (step 5), write NOTHING, stop. This is the whole reason the lock exists — a
no-change sync costs one clone and one line.

## 4. The delta, then the full sync

    git -C <tmpdir> log --oneline --name-only <lock-commit>..origin/master

Report this FIRST — which files moved and why (the commit messages are the "why" the
sync PR body needs). If the lock's commit is not in the clone's history (upstream
history was rewritten), say so and fall back to the full pass.

Then follow UPDATE.md in full. **The lock scopes the report of what is NEW upstream; it
never replaces the Class A byte-compare.** A lock proves which playbook was last
applied — not that the repo's files still match it; local drift is invisible to it.

## 5. The doc-size report (every run, including the fast path)

`wc -w` over the auto-loaded memory files — `CLAUDE.md`, `AGENTS.md`, any file they
`@`-include — and `docs/RUNBOOK.md`. Where the lock carries `docs` baselines, report
growth since the last compaction ("AGENTS.md 4,504 → 6,100 words, +35%"). Noticeable
growth → suggest `/playbook-compact`. This is a SIGNAL to the human, never a gate:
right size is per-project judgment, and no number here ever blocks a sync.

## 6. Land it

One branch, one PR (`chore: sync playbook files`), shipped by this repo's own rules,
exactly as UPDATE.md's "Apply" section says — with the lock rewritten in the same PR:

    # agent-playbook sync state — machine-written by the playbook-update and
    # playbook-compact skills; do not edit by hand.
    commit <new playbook HEAD sha>
    synced <YYYY-MM-DD>

Keep any existing `docs` baseline lines — they belong to `/playbook-compact`.
