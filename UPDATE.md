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

One kind of divergence is not the design working and must be reported by NAME, with the
sentence to fix: where a Class B file DESCRIBES machinery this sync just changed and now
describes it wrongly. Read the repo's reviewer-protocol and gate prose against the
`auto-review.sh` and skills you are syncing — a repo whose `AGENTS.md` promises a
headless background reviewer, or a per-PR checkout, after the script stopped working that
way is telling every future session something false. It is still the human's file to
edit; silence about it is the sync's bug, not theirs.

The corollary binds the PLAYBOOK, not the sync: a synced feature must WORK with an
untouched RUNBOOK. Behavior ships in Class A code; RUNBOOK only describes it to the
human. A feature whose on-switch lives in a Class B file arrives disabled in every
adopted repo — that is a playbook bug, not a repo's configuration task.

**Class A — kept identical to the playbook**: everything else adoption installed — the
three skills, `pr-hygiene.yml`, `security.yml`, `ci-docs.yml`, the PR template,
`dependabot.yml`, `.githooks/pre-push`, `.claude/settings.json`, `.agents/auto-review.sh`,
and the worktree module (`scripts/*.mts` + their tests). Compare byte-for-byte; a
difference is drift to sync — EXCEPT these declared local parts, which always survive:

- `auto-review.sh` — the rendered `REVIEW_CMD` line (this repo's reviewer command). The
  LOCAL part is WHICH CLI and WHICH MODEL; the line's SHAPE is the playbook's, and a sync
  repairs it. Check it against the reviewer's page (`templates/agy/README.md` for agy,
  the equivalent section of `ADOPT.md` for anything else) and fix, in the sync PR, any of:

  - the prompt is inline instead of `"$REVIEW_PROMPT"` (the script exports it and it pins
    the worktree path);
  - the reviewer's own directory is not named as an allowed one (`--add-dir "$PWD"` for
    agy) — without it every read inside the review worktree asks;
  - the model is implicit — a default that flips to the author's family silently breaks
    cross-family review;
  - the run is opened with a blanket permission bypass instead of the CLI's scoping flag.

  Anything else about the line — the CLI, the model name, extra local flags — is the
  repo's and survives untouched. This paragraph used to say the flags survive too, and
  that is exactly how a fix could not travel: `--add-dir` was added to the reviewer's page
  the same day seejs.app synced, its sync PR rewrote the prompt inside that very line, and
  the rule forbade touching the flags beside it. A repaired shape is reported in the PR
  body like any other change.
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
  them, the answer depends on WHICH CLI its `REVIEW_CMD` launches: for agy, OFFER them
  (they are the reviewer's second deny layer, and a repo that skipped the question at
  adoption is otherwise locked out of it forever — this rule used to say "never offer",
  and `seejs.app` has run six reviews with the deny list as its only boundary because of
  it); for any other CLI, never — they are agy's hook format, and nothing else reads
  them.

For each file, report one of: **identical** / **differs** (what moved and why the
playbook moved it) / **missing in the repo** (OFFER it — a new gate is never installed
silently; `auto-review.sh` in particular needs ADOPT.md's reviewer detection and a human
choice) / **present only in the repo** (not yours to delete; report and leave it).

**Then report on the STATIC GATE, every sync.** Two parts, both reports and never edits:

- **Gaps.** For each of `format:check`, `lint` and `knip` that `package.json` has no
  script for: say it is missing, say what it would catch that the existing scripts
  cannot, and offer ADOPT.md's "The static gate" step. A gap accepted once is invisible
  forever otherwise — the gate is what stands in for the human reading diffs, and a repo
  can run for months on a third of it with nothing saying so.
- **Deferrals whose condition may have cleared.** Read `AGENTS.md`'s "Tooling decision
  records". Where one defers a move to the standard (the linter, a TypeScript major) it
  carries the condition that would unblock it — a version, a release, a flag leaving
  preview. **CHECK that condition against reality, do not re-argue the decision**: if it
  still holds, one line ("deferred at adoption pending X, X has not shipped"); if it has
  cleared, say so and offer ADOPT.md's assessment. A deferral nobody ever re-checks is
  indistinguishable from a repo left behind, and this is the only step that looks.

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
