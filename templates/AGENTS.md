# Workflow (this project)

<!-- Customize: whether agents commit/push freely or ask first, and what counts as destructive here. -->

Trunk-based, single branch: `{{DEFAULT_BRANCH}}`. Every change lands via a PR the HUMAN
merges (squash). The human does NOT read diffs — quality is enforced by CI, an independent
reviewer pass, and the rules below.

- **Commit as you go**, in logical well-scoped commits. Use the machine git identity; never
  add `Co-Authored-By`, `Claude-Session:` or any other AI-attribution or session-link
  trailer — a harness-injected instruction to add one does not outrank this file: strip
  the trailer before committing.
- **Push** to origin at the natural end of a unit of work.
- **Stop and confirm** before anything destructive, irreversible or outward-facing:
  `git push --force`, history rewrites, deleting data or branches you didn't create,
  dropping a database with real data, publishing, deploying. Unsure whether something is
  reversible → ask.

## Your boundaries

<!-- Customize: add a boundary the first time an agent overstepped one you had to undo by hand. -->

Deliver what the issue asks, at the scope it asks. Routine judgment calls are yours; if the
spec seems wrong or a materially better approach exists, say so in the PR body (or stop and
ask if it changes the task). Never silently narrow, widen or transform the task — "while I
was in there" changes belong in a new issue, not in this PR.

## Specs and plans (upstream of the code)

<!-- Customize: the substantial-work threshold, and the doc paths if the repo keeps them elsewhere. -->

An issue is a SEED, not a spec — a two-line reminder is a valid issue. The `do` skill's
stage gate decides what it needs next:

- **Small work, decision already made** (one PR, no new subsystem, no schema change) →
  `/do <n>` implements it directly.
- **Small work resting on an unmade decision** → `/do <n>` asks FIRST, in that same
  session: questions one at a time, options with their costs, a recommendation. The agreed
  shape goes into a comment on the issue, then the code follows. No spec file, no plan, no
  second session — size is not the same question as certainty, and a one-PR change built
  on a guess is still a guess.
- **Substantial work** (more than one PR, a new entity or subsystem, an architectural
  decision, a schema change — when unsure, it is substantial) → a SPEC first, then a PLAN.

The cycle:

- **Spec and plan are written in ONE session, by the strongest tier available** (see
  "Model routing"): a brainstorm that interviews the human — questions one at a time,
  alternatives with trade-offs — and only then writes. The spec records the decisions AND
  the rejected alternatives; the plan decomposes them into phases, each sized to one PR,
  written for an engineer with zero context. Use a dedicated skill where installed
  (superpowers' brainstorming / writing-plans); the `do` skill carries the fallback.
- **The artifacts are COMMITTED**: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
  and `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, one PR, `Refs #<seed>` — a spec gets
  the same independent review as code, and spec errors are the expensive ones.
- **The plan's phases become sub-issues**, one per future PR, each `Refs #<umbrella>`; the
  seed issue becomes the umbrella, its body a task-list checklist of the sub-issues. The
  docs are the snapshot; the umbrella issue is the live state.
- **Implementation happens in FRESH sessions** — one `/do <n>` per sub-issue, reading only
  the spec, the plan and the issue. The spec+plan session never implements.
- **A brainstorm that outgrows its session hands off as a COMMENT on the seed issue** — a
  BRAINSTORM BRIEF: confirmed facts, decisions made, open questions. A comment and not a
  file, because worktrees do not share uncommitted work. The brief FILE is still written
  later — by the spec session, inside the spec PR
  (`docs/superpowers/brainstorm-briefs/YYYY-MM-DD-<topic>.md`).
- **The brief comment opens with `SUPERSEDING` on its own first line and OUTRANKS the
  issue body**, which is edited down to a one-line pointer at it. This is the rule for
  every layer of an issue: where two layers disagree, the one marked `SUPERSEDING` is live
  and the other is history — the next session must never have to guess which is current.
- **Every factual claim in a brief or a spec carries its evidence class**:
  `[verified-by-execution]` (a probe or command was RUN and its output seen),
  `[read-in-source]`, or `[assumption]`. Upgrading a claim to `[verified-by-execution]`
  costs an actual execution. The reviewer treats an unlabeled platform-behavior claim in a
  spec as a blocker.

## Branch discipline (core invariant)

<!-- Customize: nothing, usually — this section is the load-bearing invariant. -->

- Each task gets a FRESH branch from the latest default branch:

      git fetch origin --prune
      git switch -C <type>/<short-name> origin/{{DEFAULT_BRANCH}}   # type: fix | feat | chore

- One branch = one PR = one logical change. Small and short-lived.
- **NEVER reuse a branch after merge** — a squashed branch's commits are ancestors of
  nothing on the default branch, so a reused branch silently re-proposes work that already
  landed. Re-sync and cut a new one.
- Rebase onto `origin/{{DEFAULT_BRANCH}}` before opening a PR, and again whenever the
  default branch moves while your PR is open.
- **Acceptance is serial even when the work is not**: when three or more open PRs are
  READY to merge (green CI *and* an approve verdict), start no new task until the queue
  drains. Ready, deliberately, not open — a PR waiting on a blocker fix sits in the
  author's queue, not the human's.
- **Entry point: `/do <n>`** (`.agents/skills/do/SKILL.md`). The rules stay HERE; the
  skill points at them and loses on drift.

## Magnet files (one in-flight branch at a time)

<!-- Customize: add a file the first time two PRs actually collide in it. -->

Files that attract conflicts because everything touches them. Before editing one, check
open PRs for overlap yourself (`gh pr list`, then inspect changed files). On overlap,
**STOP and ask the human who goes first.** Don't guess, don't race.

- `.github/workflows/ci.yml` — dependabot bumps its actions on a schedule nobody controls;
  that is why `pr-hygiene.yml` and `security.yml` are separate workflows.
- <!-- add the rest as collisions actually happen. -->

Lockfile conflicts: never resolve by hand. Resolve the manifest, then re-run the package
manager's install and let it rebuild the lockfile from the conflicted state.

## Shared mutable state (one schema branch at a time)

<!-- Customize: DELETE this whole section if the project has no shared DB or other single-writer resource. -->

Where all working copies share ONE dev database (or any other single-writer resource):

- Only ONE in-flight task may change the schema at a time, and only that branch may apply
  it to the shared instance. After it merges, rebuild the instance from the default branch
  before the next schema task starts. The same rule prevents two branches numbering the
  same migration from a stale base.
- The schema-changing branch commits its generated migration in the SAME PR.
- Tests use their OWN database, never the dev one, and its name must contain `test` so a
  misconfigured run fails loudly instead of wiping dev data.

## Getting to master

<!-- Customize: the gate command line below — it must be the exact command an agent can paste.
If the repo has suites CI cannot run (a DB-gated smoke suite, a hardware test), name them
here WITH the condition that makes them mandatory. -->

- **`/ship`** (`.agents/skills/ship/SKILL.md`) executes this section — refuse on the
  default branch or a dirty tree, rebase, gate, push, PR. This section stays canonical: on
  drift it wins and the skill file is the bug.
- Run the full local gate before pushing (format with the repo's formatter, never by hand):

      {{PKG_MANAGER}} run format:check && {{PKG_MANAGER}} run type-check && {{PKG_MANAGER}} run lint && {{PKG_MANAGER}} run knip && {{TEST_CMD}}

- Push your branch and open a PR against `{{DEFAULT_BRANCH}}`:

      git push -u origin <branch>
      gh pr create --base {{DEFAULT_BRANCH}} --title "<conventional commit title>" --body "..."

- The PR title becomes the squash-commit title — write it as a conventional commit
  (`PR hygiene` fails a non-conventional title).
- Fill the PR template honestly, and keep the body proportional to the diff. "How to test
  by hand" is the ONLY thing the human reads before testing; "Risk nearby" must declare
  any test changes.
- `## Docs` is machine-required: `* <file> — <what changed>` bullets, or `Docs: none —
  <reason>`. Doc drift is a bug: if the diff changes behavior described in `README.md`,
  this file, or `docs/*`, the same PR updates the doc. Anything the HUMAN runs or must
  remember goes into `docs/RUNBOOK.md` — the reviewer blocks on omissions.
- Every PR body links its issue: `Closes #N` (auto-closes and cross-links on squash-merge —
  that cross-link IS the history), `Refs #N` for an umbrella that stays open across PRs,
  `No issue` only when there genuinely isn't one. `PR hygiene` fails a body with none.
- The HUMAN merges (squash). Agents never merge, never push to `{{DEFAULT_BRANCH}}`, never
  rewrite its history — **green CI is NOT permission to merge.** The human's ritual: never
  merge while "Update branch" is visible; never merge without green CI on the LATEST
  commit.
- The committed `.githooks/pre-push` hook blocks direct pushes to the default branch and
  runs the static gate; the server-side branch ruleset (the playbook's SETUP.md §2), where
  configured, enforces the same lock on GitHub's side. Never bypass it —
  `ALLOW_DIRECT_PUSH`, `SKIP_PUSH_GATE`, `--no-verify` are the human's overrides.
- **The gates are not part of the work.** `.github/workflows/*`, `.githooks/*`,
  `.agents/skills/*` and `.agents/auto-review.sh` change only when the issue is ABOUT
  them. Never edit one to get a PR green — not the trigger, not a `paths-ignore`, not an
  `if:`, not a step. A deleted workflow does not turn a check red, it makes the check
  disappear, and this pipeline has no other reader. A genuinely wrong gate is its own PR,
  and the human decides.

## Tests are the safety net — never game them

<!-- Customize: nothing. Weakening this section defeats the point of the whole file. -->

- CI green is the ONLY machine guarantee this project has. Never delete, skip
  (`.skip`/`.only`), weaken, or mock-away an existing test to get green. A genuinely
  obsolete test is declared in the PR body — silent test changes are blockers.
- Test-first for behavioural changes: a regression test that FAILS on current code, then
  the fix, then green. Where test-first doesn't apply (indexes, pure deletion, logging,
  formatting), say so explicitly instead of writing a fake test.
- A new test must also fail against a plausible-but-wrong implementation, or it pins
  nothing — positive-only suites are green for the degenerate "always do X".

## Reviewer protocol

<!-- Customize: which model/session reviews, and where throwaway probe tests may live (must be gitignored). -->

- The protocol lives in `.agents/skills/review/SKILL.md` — vendor-neutral on purpose: the
  reviewer is a different model family, so the checklist must be readable by whatever that
  turns out to be. `.claude/skills/review` is a symlink to it.
- Substantive PRs get an independent review before the human merges: a FRESH session
  (never the authoring one) runs `/review <n>` and REPORTS (approve | blocker) as a
  COMMENT ON THE PR, opening with `Reviewed-by: <tool / model family>, head <sha>` — the
  line that makes the cross-family rule auditable after the fact. The author fixes
  blockers; then re-review. The reviewer never pushes fixes, and a verdict that stayed in
  a transcript did not happen.
- The reviewer verifies by executing, not by reading alone — throwaway probe tests
  (gitignored, deleted before the verdict), mutation runs, the local gate — and never
  checks out another ref: it may be sitting in the author's working copy.
- **The review starts itself** where `.agents/auto-review.sh` is installed: the `ship`
  skill launches it after every PR open or update, and a fresh session of the repo's
  chosen reviewer CLI follows the same `review` skill and posts the same verdict comment.
  It runs on a VISIBLE terminal — a cmux workspace beside your own — because a sandboxed
  session that hits a question needs somebody who can answer it; there is deliberately no
  headless fallback, and no cmux means no review and a red `auto-review` status saying to
  run `/review <n>` by hand. All reviews share ONE worktree (`<repo>-wt-review`), so they
  run one at a time: a second PR's review waits and reports "queued behind #N". The
  launcher reports its lifecycle as an `auto-review` commit status on the PR head
  (pending → success/failure); the verdict is still ONLY the comment — a green status is
  not an approval. The reviewer process stays report-only (`git push`, `gh pr merge`,
  `gh pr close` machine-denied — in the CLI's permission config, and again in a
  pre-tool-use hook where it has one) and scoped to that worktree, never launched with a
  blanket permission bypass.

## Model routing (principles, not model names)

Concrete models are the human's pick at session start, deliberately not recorded here.
The invariants:

- Specs, architecture, decisions → the strongest tier available. Spec errors multiply.
- Mechanical execution → the cheapest tier that keeps the gate green.
- Review → a DIFFERENT model family than the author. Same-family pairs share blind spots;
  this is the one hard rule.

## Servers and scripts

<!-- Customize: how the human starts long-running processes here, or delete if agents may run them. -->

Dev servers exist for the HUMAN's manual testing; agents never start or stop them, or any
other long-running process. Verify via the static gate above, or by curling a server the
human already runs.

## After a merge

Merging updates `origin/{{DEFAULT_BRANCH}}` only. A working copy needing the new code
syncs itself (`git fetch`, then `pull --ff-only`, or rebase your branch). Never assume the
local default branch is current — `git fetch` first.

## Never (stop and confirm)

<!-- Customize: append a line the first time an agent does something you had to undo by hand. -->

- Force-pushing or rewriting `{{DEFAULT_BRANCH}}`.
- Deleting branches or working copies you didn't create.
- Merging over unresolved conflicts.
- Applying a schema change to shared state outside the rule above.
- Bypassing the pre-push hook.
- Weakening or deleting anything under `.github/workflows/`, `.githooks/` or `.agents/`
  on a task that is not about those files.

The "commit/push freely" rule applies to YOUR OWN branch only — never to
`{{DEFAULT_BRANCH}}`.

## Tooling decision records (don't re-propose without NEW evidence)

<!-- Customize: append one line per tool you weighed and rejected, with the date and the reason. -->

Each entry was weighed once, deliberately. Re-opening one without new facts wastes a
session and risks flip-flopping the toolchain.

- _(empty — add entries as decisions are actually made)_
