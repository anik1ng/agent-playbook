# UPDATE.md — how an agent re-syncs an adopted repository

You are an agent, syncing a repository that already carries this workflow against the
current playbook. The human says: *"Read UPDATE.md from github.com/anik1ng/agent-playbook
and sync this repository."* If the repo carries none of the files below, it is not
adopted — that is `ADOPT.md`'s job; stop and say so.

Fetch fresh, never a stale copy or a partial download of single files:

    git clone --depth 1 https://github.com/anik1ng/agent-playbook <tmpdir>

## Two classes of file

**Class B — a sync never touches these on its own authority**: `AGENTS.md`,
`.github/workflows/ci.yml`, `docs/RUNBOOK.md`. They are rendered once at adoption and
then GROW with the repo — divergence there is the design working, not drift. If the
playbook's template contains an improvement this repo would genuinely want, NAME it to
the human and stop; never apply it, never fold it into the sync PR. Two edits — and only
two — may reach a Class B file from a sync, both defined below and both gated on the
human's explicit yes: correcting prose that describes the installed machinery falsely,
and the wiring ADOPT.md's static-gate step performs when its offer is accepted.

One kind of divergence is not the design working and gets REPAIRED, not just named:
where a Class B file DESCRIBES machinery falsely. Read the repo's reviewer-protocol and
gate prose against the `auto-review.sh`, skills and hooks as they stand AFTER this sync —
not only against what this sync touched, because stale prose usually outlives the change
that stranded it by several syncs. A repo whose `AGENTS.md` promises a headless
background reviewer, or a per-PR checkout, after the script stopped working that way is
telling every future session something false. A file is declared CORRECT by the same
standard it is declared false — its lines, read fact-by-fact against the machinery, with
citations ("Verification discipline" below); "describes it correctly" without line
numbers is the file being skipped, not checked. Put the exact replacement sentences in
the report; with the human's yes, apply them in the sync PR, listed per file in the PR
body.
That consent covers CORRECTIONS only — prose contradicting the installed machinery —
never the improvements of the paragraph above, which stay report-only. (This used to be
report-only too, with the sentences left for the human to type in: `seejs.app` carried
the same three stale paragraphs across two syncs, because "the human's file to edit"
reliably means nobody edits it — the sync writes the sentences anyway, so the human's
part is the yes, not the typing.)

The corollary binds the PLAYBOOK, not the sync: a synced feature must WORK with an
untouched RUNBOOK. Behavior ships in Class A code; RUNBOOK only describes it to the
human. A feature whose on-switch lives in a Class B file arrives disabled in every
adopted repo — that is a playbook bug, not a repo's configuration task.

**Class A — kept identical to the playbook**: everything else adoption installed — the
three skills, `pr-hygiene.yml`, `security.yml`, `ci-docs.yml`, the PR template,
`dependabot.yml`, `.githooks/pre-push`, `.claude/settings.json`, `.agents/auto-review.sh`,
the worktree module (`scripts/*.mts` + their tests) and the schema-lock module
(`scripts/schema-lock.mts`, `scripts/check-schema-lock.mts`, `scripts/schema-lock.test.ts`
— its config file is wholly local, below). Compare byte-for-byte; a
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
  Where no date is recorded, the sweep has not happened — or was never written down,
  which reads the same a year later: OFFER to run it now (gitleaks over the full
  history, in the sync's own worktree) and record the date in the same PR. Report what
  the sweep finds VERBATIM before recording anything; never invent a date, and if the
  human says they swept by hand, the date is theirs to supply.
- `dependabot.yml` — a `docker` ecosystem entry, where the repo added one for its own
  `Dockerfile` (ADOPT.md's snippet); the template ships without it on purpose. The check
  runs BOTH ways, every sync: a tree that holds a `Dockerfile` while `dependabot.yml`
  has no `docker` entry gets the OFFER — a repo that grew its Dockerfile after adoption
  is otherwise never asked, and its base image stays unwatched forever (how seejs.app's
  build image went stale in silence).
- `settings.json` — everything except the template's two keys (`attribution` and the
  auto-review allow rule); the file was installed by merging, so local content is the
  design working.
- `worktree-utils.mts` — the `ALLOWED_ENV_VARS` list; plus any per-worktree service
  provisioning this repo added to setup/teardown.
- `schema-lock.config.mts` — the WHOLE file is the repo's: it declares this repo's
  schema surface, the module's one per-repo fact. A sync never touches it — but a
  surviving `{{SCHEMA_SURFACE}}` token in it is a finding for the human: the check has
  been failing loudly since adoption, or was installed without its surface.
- The worktree and schema-lock modules' `package.json` wiring travels WITH their files:
  a sync that brings
  a new `scripts/*.mts` whose ADOPT.md snippet names a script for it (e.g. `worktree:gc`
  → `gc-worktrees.mts`) adds that line to `package.json` in the same PR — and a sync that
  REMOVES a module file (`reaper.mts` and its `task:reaper` entry retired 2026-08-14,
  replaced by `worktree:gc`) removes its script line the same way. A script file no
  command can reach is the module arriving disabled, the exact failure the Class B
  corollary above names. The same travel rule covers `.oxfmtrc.json`'s ignore list:
  the template names the module's files one by one (never `scripts/**` — the directory
  also holds repo-owned scripts that must stay visible to `format:check`), so a sync
  that adds or removes a module file edits its ignore line in the same PR. The config
  file itself is the repo's — patterns it added beside the module's lines (its own
  docs, Markdown) are the design working, not drift; only the module-file entries are
  the playbook's to keep in step.
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

**Then report on the STATIC GATE, every sync.** Two parts, both reported before anything
is written; edits happen only on a yes:

- **Gaps.** For each of `format:check`, `lint` and `knip` that `package.json` has no
  script for: say it is missing, say what it would catch that the existing scripts
  cannot, and offer ADOPT.md's "The static gate" step. A gap accepted once is invisible
  forever otherwise — the gate is what stands in for the human reading diffs, and a repo
  can run for months on a third of it with nothing saying so.

  **An accepted offer is executed in THIS sync**, exactly as ADOPT.md writes the step —
  install, the ready config, fixing what the new tools flag in existing code, the
  reformat as its own commit — not filed as the human's homework. That step edits
  `ci.yml`, `ci-docs.yml` and the gate lines in `AGENTS.md` / `docs/RUNBOOK.md` by
  design: the human's yes to the step IS the consent the Class B protection exists to
  secure, so "a sync never touches these" is no reason to land the tools with the gate
  half-wired — a `lint` script that ci.yml never runs is the gap again, one layer down.
- **Deferrals whose condition may have cleared.** Read `AGENTS.md`'s "Tooling decision
  records". Where one defers a move to the standard (the linter, a TypeScript major) it
  carries the condition that would unblock it — a version, a release, a flag leaving
  preview. **CHECK that condition against reality, do not re-argue the decision**: if it
  still holds, one line ("deferred at adoption pending X, X has not shipped"); if it has
  cleared, say so and offer ADOPT.md's assessment. A deferral nobody ever re-checks is
  indistinguishable from a repo left behind, and this is the only step that looks.

**Then look INSIDE the reviewer worktree's env file, every sync** — on disk
(`../<repo>-wt-review/.env*`), never only in git. `auto-review.sh` runs
`worktree:setup` only when `node_modules` is missing, so a reviewer worktree
provisioned under an older scheme keeps its old env file indefinitely — one adopted
repo's reviewer carried a full copy of the maintainer's credentials across every
review, and nothing else looks. The file may hold nothing beyond what today's
`worktree:setup` writes (the derived values plus `ALLOWED_ENV_VARS` keys); anything
more is a finding: report it verbatim by KEY NAME (never the values), and with the
human's yes delete the file and re-run `worktree:setup` in that worktree so it is
rewritten minimal. Where no reviewer worktree exists, or the worktree module is not
installed, one line says so.

## Verification discipline (binds every claim in the report)

The failure this section exists for was real: a sync declared `docs/RUNBOOK.md` correct
while its lines still described a worktree scheme two syncs dead — the file was
remembered, not read. The rules:

- **Every claim carries its evidence class**, exactly as briefs and specs do:
  `[verified-by-execution]` or `[read-in-source]`. A verdict may never rest on an
  assumption. "Identical" is a byte comparison you RAN — name the command once for the
  whole class; "correct" is lines you READ and cite.
- **Prose is checked fact-by-fact, never by impression.** First extract from the
  installed machinery — `auto-review.sh`, the skills, the hooks, the worktree scripts —
  the list of facts a Class B file could describe: how the reviewer is launched, the
  worktree scheme and its name, the trust prompt's cadence, serialization, the deny
  layers, lifecycle status, who retires the worktree, what the gate runs. Then read
  EVERY Class B file against EVERY fact, citing `file:lines` — for matches exactly as
  for contradictions. A file that says nothing about a fact is "silent on it", said so;
  silence is never rounded up to "correct".
- **Nothing inherits from the last sync.** Prior reports, open or unmerged PR text, and
  your sense of what was already fixed are not evidence: a proposed fix is not a landed
  one, and the repo is checked as it stands on its default branch. If an earlier sync's
  PR never merged, everything it proposed is still broken today.
- **The report is a fixed form.** Every section appears in every report, in order, even
  when its content is "nothing found": (1) per-file Class A verdicts, (2) the
  `REVIEW_CMD` shape check, (3) the Class B fact matrix, (4) static-gate gaps, (5)
  deferral re-checks, (6) the sweep date, (7) symlinks and `{{...}}` tokens, (8) the
  reviewer worktree env check, (9) local fixes to propose upstream. An absent section is
  indistinguishable from an unchecked
  one — which is exactly what it usually is.
- **Last, re-read your own report as its adversary**: every verdict missing its
  evidence is a hole to go fill before showing the human anything, not a sentence to
  soften. The human merges without reading diffs; this report is the only witness.

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
