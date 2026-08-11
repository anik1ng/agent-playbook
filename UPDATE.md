# UPDATE.md — how an agent re-syncs an adopted repository

You are an agent, syncing a repository that already carries this workflow against the
current playbook. The human says: *"Read UPDATE.md from github.com/anik1ng/agent-playbook
and sync this repository."* If the repo carries none of the files below, it is not
adopted — that is `ADOPT.md`'s job; stop and say so.

Fetch fresh, never a stale copy or a partial download of single files:

    git clone --depth 1 https://github.com/anik1ng/agent-playbook <tmpdir>

## Two classes of file

**Class B — a sync never touches these**: `AGENTS.md`, `.github/workflows/ci.yml`,
`docs/RUNBOOK.md`. They are rendered once at adoption and then GROW with the repo —
divergence there is the design working, not drift. If the playbook's template contains an
improvement this repo would genuinely want, NAME it to the human and stop; never apply it,
never fold it into the sync PR.

**Class A — kept identical to the playbook**: everything else adoption installed — the
three skills, `pr-hygiene.yml`, `security.yml`, `ci-docs.yml`, the PR template,
`dependabot.yml`, `.githooks/pre-push`, `.claude/settings.json`, `.agents/auto-review.sh`,
and the worktree module (`scripts/*.mts` + their tests). Compare byte-for-byte; a
difference is drift to sync — EXCEPT these declared local parts, which always survive:

- `auto-review.sh` — the rendered `REVIEW_CMD` line (this repo's reviewer command).
- `security.yml` — the header line recording this repo's one-time secret-sweep date.
- `settings.json` — everything except the template's two keys (`attribution` and the
  auto-review allow rule); the file was installed by merging, so local content is the
  design working.
- `worktree-utils.mts` — the `ALLOWED_ENV_VARS` list; plus any per-worktree service
  provisioning this repo added to setup/teardown.
- `ci-docs.yml` — its job `name:` and `paths:` mirror THIS repo's `ci.yml`. Where they
  mirror it they are correct; where they don't, that is a finding for the human — the
  required check hangs on some class of PR either way.
- `.agents/guard-reviewer.sh` + `.agents/hooks.json` (← `templates/agy/`) — Class A
  where the repo HAS them, with one declared insertion: a best-effort notify line the
  repo may have added to the guard's non-matching branch. Where the repo does NOT have
  them, never offer them — they are agy's hook format, and a repo reviewing with a
  different CLI would be installing files nothing reads.

For each file, report one of: **identical** / **differs** (what moved and why the
playbook moved it) / **missing in the repo** (OFFER it — a new gate is never installed
silently; `auto-review.sh` in particular needs ADOPT.md's reviewer detection and a human
choice) / **present only in the repo** (not yours to delete; report and leave it).

## Apply

Show the human the per-file summary BEFORE writing anything — writing first makes the
review theatre. Then land everything agreed as ONE branch and ONE PR
(`chore: sync playbook files`), shipped by this repo's own rules. Edit the real files
under `.agents/` — never through the `.claude/skills` symlinks — and check afterwards
that the symlinks are still symlinks. No `{{...}}` token may survive in anything you
wrote. The PR body lists, per file, what changed and why the playbook changed it: the
human merges without reading diffs, and this body is their only account.

## Fixes flow playbook-first

When the diff shows the repo's copy is the BETTER one — a local fix the playbook never
got — do not overwrite it, and do not quietly keep it either: tell the human, and propose
it upstream to the playbook so it comes back down through a later sync. An improvement
that lives in exactly one repository is the failure this page exists to prevent.
