# Workflow (this project)

<!-- Customize: whether agents commit/push freely or ask first, and what counts as destructive here. -->

Trunk-based, single branch: `{{DEFAULT_BRANCH}}`. Every change lands via a PR the HUMAN
merges (squash). The human does NOT read diffs — quality is enforced by CI, a reviewer
pass, and the rules below. That is the whole bargain: every rule here exists so a machine
or a fresh session can catch what no one is reading for.

- **Commit as you go**, in logical well-scoped commits. Use the machine git identity;
  never add `Co-Authored-By` / AI-attribution trailers. In Claude Code this is a setting
  rather than a request — `.claude/settings.json` sets `attribution` to empty strings — but
  the rule stays written here, because the tools that rule most needs to reach are the ones
  that never read that file.
- **Push** to origin when it's the natural end of a unit of work.
- **Stop and confirm** for genuinely destructive / irreversible / outward-facing actions:
  `git push --force` or history rewrites, deleting data or branches you didn't create,
  dropping a database that holds real data, publishing packages, deploying. When unsure
  whether something is reversible, ask.

## Your boundaries

<!-- Customize: add a boundary the first time an agent overstepped one you had to undo by hand. -->

- Deliver what the issue asks, at the scope it asks. Make routine judgment calls yourself;
  if the spec seems wrong or a materially better approach exists, say so in the PR body (or
  stop and ask if it changes the task) — never silently narrow, widen, or transform the task.
  "While I was in there" changes belong in a new issue, not in this PR.

## Branch discipline (core invariant)

<!-- Customize: nothing, usually — this section is the load-bearing invariant. Change only the branch-type vocabulary. -->

- Each task gets a FRESH branch from the latest `origin/{{DEFAULT_BRANCH}}`:

      git fetch origin --prune
      git switch -C <type>/<short-name> origin/{{DEFAULT_BRANCH}}   # type: fix | feat | chore

- One branch = one PR = one logical change. Small and short-lived.
- **NEVER reuse a branch after merge** — re-sync and cut a new one. A squashed branch's
  commits are never ancestors of the default branch, so a reused branch silently re-proposes
  work that already landed.
- Rebase onto `origin/{{DEFAULT_BRANCH}}` before opening a PR, and again whenever the
  default branch moves while your PR is open.
- **Entry point: `/do-issue <n>`** (`.agents/skills/do-issue/SKILL.md`) — the executable form
  of this section plus the kickoff preamble (read this file, read the issue AND its comments,
  branch, implement, ship). The rules stay HERE; the skill points at them and loses on drift.

## Magnet files (one in-flight branch at a time)

<!-- Customize: this is the list to actually fill — add a file the first time two PRs collide in it. -->

Files that attract conflicts because everything touches them. Before editing one, check open
PRs for overlap yourself (`gh pr list`, then inspect changed files). If an open PR touches
the same file, **STOP and ask the human who goes first.** Don't guess, don't race.

- `.github/workflows/ci.yml` — the one entry that starts here instead of being earned. Both
  `pr-hygiene.yml` and `security.yml` already exist as SEPARATE workflows for the stated
  reason that this file is a magnet, and dependabot bumps its actions on a schedule nobody
  controls. Leaving the list empty would contradict two files in this repo.
- <!-- add the rest as collisions actually happen. Typical, once they bite: package manifest + lockfile, shared config, this file -->

Lockfile conflicts: never resolve by hand. Resolve the manifest, then re-run the package
manager's install and let it rebuild the lockfile from the conflicted state.

## Shared mutable state (one schema branch at a time)

<!-- Customize: DELETE this whole section if the project has no shared DB or other single-writer resource. -->

Where all working copies share ONE dev database (or any other single-writer resource):

- Only ONE in-flight task may change the schema at a time, and only that branch may apply it
  to the shared instance. After it merges, the shared instance is rebuilt from the default
  branch before the next schema task starts.
- The same one-at-a-time rule prevents migration collisions: two branches generating a
  migration from a stale base would both number it `0001_*` and collide in the journal.
- The schema-changing branch commits its generated migration in the SAME PR as the schema
  change. A CI drift check should fail the PR otherwise.
- Tests use their OWN database, never the dev one, and its name must be distinguishable
  (contain `test`) so a misconfigured run fails loudly instead of wiping dev data.

## Getting to master

<!-- Customize: the gate command line below — it must be the exact command an agent can paste. -->

- **`/ship`** (`.agents/skills/ship/SKILL.md`) is the executable form of this section — refuse
  on the default branch or a dirty tree, rebase, gate, push, PR. This section stays canonical:
  on drift it wins and the skill file is the bug.
- Run the full local gate before pushing:

      {{PKG_MANAGER}} run type-check && {{PKG_MANAGER}} run lint && {{TEST_CMD}}

  Format with the repo's formatter, never by hand.
- Push your branch and open a PR against `{{DEFAULT_BRANCH}}`:

      git push -u origin <branch>
      gh pr create --base {{DEFAULT_BRANCH}} --title "<conventional commit title>" --body "..."

- The PR title becomes the squash-commit title — write it as a conventional commit
  (`PR hygiene` fails a non-conventional title).
- Fill the PR template honestly. "How to test by hand" is the ONLY thing the human reads
  before testing; "Risk nearby" must declare any test changes.
- Match the PR body's length to what the diff needs: cover the substance, skip filler. A
  reviewer should be able to read "What & why" in under a minute; long evidence belongs in
  the issue or a comment, not the body.
- Fill the `## Docs` section — `PR hygiene` machine-requires it: `* <file> — <what changed>`
  bullets, or `Docs: none — <reason>`. Doc drift is a bug: if the diff changes behavior
  described in `README.md`, this file, or `docs/*`, the same PR updates the doc. Anything the
  HUMAN runs or must remember (script, page, env var, ritual) goes into `docs/RUNBOOK.md` —
  that page is the human's memory; the reviewer blocks on omissions.
- Every PR body MUST link its issue — this is how the loop closes itself instead of leaving
  orphaned issues the human closes by hand with no history. Put it in the body, not a
  post-merge step you'll forget: `Closes #N` (also `Fixes`/`Resolves`) makes GitHub
  auto-close the issue AND cross-link the PR into its timeline on squash-merge — that
  cross-link IS the history. Use `Refs #N` for an umbrella issue that must stay open across
  several PRs; use `No issue` only when there genuinely isn't one. The `PR hygiene` check
  fails a PR whose body carries none of these — a prose reminder alone gets skipped.
- Every PR must pass CI. The HUMAN merges (squash). Agents never merge, never push to
  `{{DEFAULT_BRANCH}}`, never rewrite its history — **green CI is NOT permission to merge.**
- The human's merge ritual: never merge while the "Update branch" button is visible (a green
  CI there belongs to a stale merge preview); never merge without a green check on the PR's
  LATEST commit.
- The committed `.githooks/pre-push` hook is the real lock against direct pushes to
  `{{DEFAULT_BRANCH}}`, and it also runs the static gate before any branch push. Never bypass
  it (`ALLOW_DIRECT_PUSH`, `SKIP_PUSH_GATE`, `--no-verify`) — those overrides are the
  human's.
- **The gates are not part of the work.** `.github/workflows/*`, `.githooks/*` and
  `.agents/skills/*` change only when the issue is ABOUT them. Never edit one to get a PR
  green — not the trigger, not a `paths-ignore`, not an `if:`, not a step, not a checklist
  line. Weakening a gate is the one change that erases its own evidence: a deleted workflow
  does not turn a check red, it makes the check disappear, and this pipeline has no other
  reader. If a gate is genuinely wrong, say so and stop — that is a separate PR, and the
  human decides.

## Tests are the safety net — never game them

<!-- Customize: nothing. Weakening this section defeats the point of the whole file. -->

- The human does not read code; CI green is the ONLY machine guarantee. Therefore: never
  delete, skip (`.skip`/`.only`), weaken, or mock-away an existing test to get CI green. A
  failing test is a signal about your code. If a test is genuinely obsolete, say so
  explicitly in the PR body — silent test changes are blockers.
- Test-first for behavioural changes: write a regression test that FAILS on current code,
  then the fix, then green. Where test-first is not applicable (indexes, pure deletion,
  logging, formatting), say so explicitly instead of writing a fake test.
- A new test must also fail against a plausible-but-wrong implementation, or it pins
  nothing. Positive-only suites are green for the degenerate implementation "always do X".

## Reviewer protocol

<!-- Customize: which model/session reviews, and where throwaway probe tests may live (must be gitignored). -->

- The protocol itself lives in `.agents/skills/review-pr/SKILL.md` — in the repo, in a
  vendor-neutral location, deliberately NOT inside a Claude Code plugin. The reviewer is
  supposed to be a different model family (see "Model routing"), so the checklist has to be
  readable by whatever that turns out to be. `.claude/skills/review-pr` is a symlink to it.
- Substantive PRs get an independent review before the human merges: a FRESH session (never
  the authoring one) runs `/review-pr <n>`. The reviewer REPORTS (approve | blocker), as a
  COMMENT ON THE PR; the AUTHOR fixes blockers; then re-review. The reviewer never pushes
  fixes, and a verdict that stayed in the reviewer's transcript did not happen.
- The verdict comment opens with `Reviewed-by: <tool / model family>, head <sha>`. That one
  line is what makes the cross-family rule auditable after the fact: without it, "a
  different family reviewed this" is a claim nobody can check against the PR's history.
- The reviewer verifies by executing, not by reading alone: throwaway probe tests (gitignored;
  deleted before the verdict), mutation runs, and the local gate. The reviewer never checks
  out another ref — it may be sitting in the author's working copy.

## Model routing (principles, not model names)

<!-- Customize: nothing to fill in here — concrete model picks are made at session start, not recorded in this file. -->

Which concrete model fills each role is the human's operational decision at session start,
re-made freely as models ship — it is deliberately NOT recorded here, so this file never lies
when the lineup changes. The invariants:

- Specs, architecture, decisions → the strongest tier available. Spec errors multiply: a bad
  plan fans out into every PR written from it. Never economize at the top.
- Mechanical execution (code on rails, refactors, doc edits) → the cheapest tier that keeps
  the gate green. Quality is guaranteed by CI and review, not by the executor's brilliance;
  step the tier up only when the gate keeps catching its output.
- Review → a DIFFERENT model family than the author. Same-family author and reviewer share
  blind spots; cross-family review disjoints them. This is the one hard rule. As a side
  effect, it also keeps the pipeline's single most frequent operation off the primary quota.

## Servers and scripts

<!-- Customize: how the human starts long-running processes here, or delete if agents may run them. -->

- Dev servers exist for the HUMAN's manual testing, and only the human starts and stops them.
  Agents NEVER start dev servers or other long-running processes. Verify your work via the
  static gate above (type-check, lint, tests), or by curling a server the human already runs.

## After a merge

<!-- Customize: nothing, usually. -->

- Merging updates `origin/{{DEFAULT_BRANCH}}` only. A working copy needing the new code syncs
  itself (`git fetch`, then `pull --ff-only`, or rebase your branch). Never assume your local
  default branch is current — `git fetch` first.

## Never (stop and confirm)

<!-- Customize: append a line the first time an agent does something you had to undo by hand. -->

- Force-pushing or rewriting `{{DEFAULT_BRANCH}}`.
- Deleting branches or working copies you didn't create.
- Merging over unresolved conflicts.
- Applying a schema change to shared state outside the rule above.
- Bypassing the pre-push hook.
- Weakening or deleting anything under `.github/workflows/`, `.githooks/` or
  `.agents/skills/` on a task that is not about those files.

The "commit/push freely" rule applies to YOUR OWN branch only — never to
`{{DEFAULT_BRANCH}}`.

## Tooling decision records (don't re-propose without NEW evidence)

<!-- Customize: append one line per tool you weighed and rejected, with the date and the reason. -->

Each entry was weighed once, deliberately. Re-opening one without new facts wastes a session
and risks flip-flopping the toolchain.

- _(empty — add entries as decisions are actually made)_
