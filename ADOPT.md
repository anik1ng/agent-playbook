# ADOPT.md — how an agent installs this workflow

You are an agent, installing the agent-playbook workflow into the repository you are
currently in. Fetch the templates with a shallow clone into a temporary directory (delete
it when done):

    git clone --depth 1 https://github.com/anik1ng/agent-playbook <tmpdir>

If the current directory is not a git repository, stop and say so.

This page gives you GOALS and BOUNDARIES, not a script. Handle the unforeseen with
judgment — an odd toolchain, a file that doesn't fit the table, a CLI whose flags moved —
and say what you found and what you chose. Where a choice is genuinely the human's (it
costs money, deletes something, or changes their habits), ask. Report what you detected
before writing anything.

## Rule 0 — existing files are the human's, not yours

Outranks everything below. **Never overwrite an existing file or setting without showing
the exact diff and getting a yes** — one file at a time. A destination that does not exist
yet you may write freely. Two standing cases: an existing `.claude/settings.json` is
MERGED, never replaced (the template owns only the `attribution` keys and the
`Bash(.agents/auto-review.sh:*)` allow rule — without that rule, restricted permission
modes silently block the reviewer launch); and an occupied `core.hooksPath` (husky,
lefthook) is never re-pointed — offer chaining (`sh .githooks/pre-push "$@" < /dev/stdin`)
or moving the hook into their directory, and say plainly that until resolved nothing
blocks a direct push.

## What to install

| Template                     | Destination                                          |
| ---------------------------- | ---------------------------------------------------- |
| `AGENTS.md`                  | `AGENTS.md`                                          |
| `RUNBOOK.md`                 | `docs/RUNBOOK.md`                                    |
| `pull_request_template.md`   | `.github/pull_request_template.md`                   |
| `workflows/*.yml` (4 files)  | `.github/workflows/`                                 |
| `dependabot.yml`             | `.github/dependabot.yml`                             |
| `githooks/pre-push`          | `.githooks/pre-push` (chmod 755)                     |
| `settings.json`              | `.claude/settings.json` (merge into existing)        |
| `skills/{do,ship,review}/`   | `.agents/skills/<name>/SKILL.md`                     |
| `scripts/auto-review.sh`     | `.agents/auto-review.sh` (755; only with a reviewer) |
| `scripts/worktree/*` (8)     | `scripts/` (only when the worktree module is wanted) |
| `tooling/*` (4)              | repo root (only the ones "The static gate" installs)  |

Plus three RELATIVE symlinks: `.claude/skills/<name>` → `../../.agents/skills/<name>`.
`.agents/` is the vendor-neutral home — Codex/ChatGPT and Antigravity/Gemini read it
directly, Claude Code follows the symlink. Never create per-vendor copies (`.gemini/`,
`.codex/`); copies drift. If `.claude/skills/<name>` already exists as a real directory,
that is Rule 0 territory: ask, never delete it to make room.

If the repo has no `CLAUDE.md`, offer one containing only `@AGENTS.md` (same offer for
another tool's wrapper file, e.g. `GEMINI.md`).

**Placeholders.** Only three files are rendered — `AGENTS.md`, `docs/RUNBOOK.md` and
`ci.yml` carry `{{DEFAULT_BRANCH}}` / `{{PKG_MANAGER}}` / `{{INSTALL_CMD}}` /
`{{TEST_CMD}}` plus ci.yml's two whole-line block placeholders — and `auto-review.sh`
carries `{{REVIEW_CMD}}`. Everything else (the hook, the worktree scripts) detects its
facts at runtime and is installed byte-for-byte. No `{{...}}` token may survive in
anything you write.

## Detect and render

- **Default branch**: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`,
  falling back to the local HEAD's name.
- **Package manager**: from the lockfile — `pnpm-lock.yaml` → pnpm /
  `pnpm install --frozen-lockfile`; `yarn.lock`, `bun.lock(b)`, `package-lock.json`
  accordingly; none → npm, and offer to commit a lockfile (CI caching and the cooldown
  policy both want one).
- **Test command**: the `test` script if it exists; a runner in devDependencies with no
  script → propose the direct command and ask; no tests at all → drop the CI test step,
  mark the gate line in `AGENTS.md`/`RUNBOOK.md` as aspirational, and say so plainly.
  Never invent a fake passing command.
- **ci.yml**: keep only the steps whose `package.json` scripts exist (`format:check`,
  `type-check`, `lint`, `build`, tests) — a step calling a missing script is a hard CI
  failure on the human's first run. Delete, don't soften with `--if-present`: a tolerant
  step is green while checking nothing. Update the job `name:` to list the surviving
  steps and mirror it byte-for-byte into `ci-docs.yml`, whose `paths:` must stay the
  exact inverse of ci.yml's `paths-ignore:` (the no-op twin reports the required check on
  doc-only PRs). Apply the same deletions to the gate line in `AGENTS.md` and
  `docs/RUNBOOK.md`. `.nvmrc`: create one from the local `node -v` major if absent —
  ci.yml reads it.
- **Missing gate tools**: see "The static gate" below — that step installs them, and
  ci.yml's steps follow from what it lands.
- **Build-time env**: don't reason about it — RUN the build with every `.env.example`
  variable set to empty (`DATABASE_URL= … run build`; explicitly-empty values survive
  framework env loaders, reproducing a runner with no `.env`). A failure naming a
  variable puts an obviously-fake dummy into `{{BUILD_ENV_BLOCK}}` (step-level, so tests
  cannot inherit it); a green build → delete the placeholder line. Do this before the
  human's first PR — a red first run reads as "the setup is broken".
- **Database in tests**: on evidence (a compose file, `DATABASE_URL` in `.env.example`, a
  driver dependency), report it and ask; yes → a service container with a health check in
  `{{DB_SERVICE_BLOCK}}` plus a job-level `DATABASE_URL`, which the Build step then
  inherits.

## The static gate (install what is missing — this is the guarantee)

The human does not read diffs. Every promise this workflow makes about quality is
carried by the gate, so a repo whose gate is `tsc --noEmit` alone is running on a third
of it: type-check sees no floating promise, no `any` spreading through three files, no
unused export, no condition that is always true, and no formatting at all. Getting the
gate complete is not polish to do later — it is the reason the human can merge without
reading.

So for each of these that the repo has no script for, **offer it with its ready config
and a recommendation to take it**, one question each, and say what it costs:

| missing script | install | template | the cost, said up front |
| --- | --- | --- | --- |
| `format:check` | `prettier` | `templates/tooling/.prettierrc.json`, `.prettierignore` → repo root | one reformat-everything commit; keep it as its own commit so it never hides a real change |
| `lint` | `oxlint` + `oxlint-tsgolint` (the standard — see below) | `templates/tooling/.oxlintrc.json` → repo root | type-aware rules surface real errors in existing code on the first run; fixing them is part of this step, not a follow-up |
| `knip` | `knip` | none — it infers entry points; add `knip.json` only where it guesses wrong | usually finds dead exports and unused dependencies immediately; it is the only one of the three that sees ACROSS files, which neither tsc nor a linter does |

**The linter is ONE standard across every repo, not a per-repo taste**: `oxlint` +
`oxlint-tsgolint`, with `templates/tooling/.oxlintrc.json` and
`"lint": "oxlint --type-aware"`. Its type-aware backend (tsgolint) carries 59 of
typescript-eslint's 61 type-aware rules, and — the fact that makes one standard possible
at all — it **bundles typescript-go, so it does not use the repo's `typescript` at all**.
A repo on TypeScript 6 and a repo on TypeScript 7 get the same linter and the same rules;
the only requirement is a `tsconfig.json` without options TypeScript 7 removed. Keep
`oxlint-tsgolint` and the repo's TypeScript moving roughly together, since the backend
tracks a TypeScript release.

`knip` is unaffected by any of this (v6 parses with oxc, not TypeScript's API), and so is
Prettier — a formatter needs no type checker.

Scripts to add — the names matter, ci.yml and `.githooks/pre-push` both look for exactly
these: `"format": "prettier --write ."`, `"format:check": "prettier --check ."`,
`"lint": "oxlint --type-aware"`, `"knip": "knip"`.

Then, whatever the answers:

- **Installed** → keep that step in `ci.yml`, keep its word in the job `name:`, mirror
  the name byte-for-byte into `ci-docs.yml`, and keep it in the gate line in `AGENTS.md`
  and `docs/RUNBOOK.md`. The pre-push hook needs nothing: it runs whichever of these
  scripts exist.
- **Declined** → delete the step, delete the word from BOTH job names, drop it from both
  gate lines — and record the decline where it will be seen again: a line in `AGENTS.md`
  under "Tooling decision records", naming what is missing and why. A decline recorded
  only in your closing summary is a decision nobody can find a month later, and the
  repository looks like it never had the option (`seejs.app` ran ten PRs with no linter
  and no formatter before anyone noticed). `UPDATE.md` re-raises what is missing on every
  sync — that only works if the answer is in the repo.

These config files are rendered ONCE and then belong to the repo: a sync never overwrites
them. They carry no `{{...}}` tokens, so "rendering" is copying them and then deleting
what does not apply — a Tailwind plugin in a repo with no Tailwind, an ignore entry for a
directory that does not exist.

### A repo already on something else: ASSESS it, never grandfather it

A repo that already has ESLint, or an older TypeScript, does not get to keep them because
it had them first. Nor do you migrate it because the standard says so. **You find out
whether it can move, with commands, and the human decides on what you found.** Two repos
drifting apart is two different quality guarantees, which is the same as none — and
"we'll do it later" without a named condition is how later never arrives.

Both assessments run in a SCRATCH worktree, never the main checkout, and neither fixes
anything: their whole output is a report. Bound them — install, run the gate, read the
errors. Do not start repairing the codebase to make a probe pass; that is the migration
itself, and it is not yours to start.

**Can the linter move (ESLint → oxlint)?**

1. Install `oxlint` + `oxlint-tsgolint`, drop in the config, run `oxlint --type-aware`.
2. Name the rules the repo's current ESLint config enables that oxlint has NO equivalent
   for. Read the overlap rather than guessing at it — `eslint-plugin-oxlint` exists to
   encode exactly that mapping, and oxlint ships built-in plugin sets (React, hooks,
   a11y, Next and others) whose coverage is a fact you can check, not estimate.
3. Run both linters over the current code and diff the findings. What only ESLint reports
   is the concrete loss; what only oxlint reports is the concrete gain. Counts and rule
   names, not adjectives.

**Can TypeScript move to 7?**

1. List every dependency that integrates through TypeScript's JS API — the framework's
   type layer, `ts-jest`, `ts-morph`, template checkers for Vue/Svelte/Astro. TypeScript 7
   ships without a stable programmatic API (7.1 is where it returns), so these are exactly
   what breaks.
2. In the scratch worktree: install TypeScript 7, run type-check, build and tests. Report
   what fails, verbatim, not paraphrased.
3. Where the framework supports 7 only behind an experimental flag, say the flag by name
   AND say it is experimental. A repo that auto-deploys on merge running on a preview flag
   is a decision the human makes knowingly, not a detail you fold into a summary.

**Then report and stop.** Three shapes, and say which you would pick and why: move now
(with the cost you measured), move partly (e.g. the linter now, TypeScript when its
blocker clears), or wait. Waiting is a legitimate answer — an unstable dependency is a
real reason — but it is only allowed to be an answer when it names **what would unblock
it**: a version, a release, a flag leaving preview.

Whatever the human decides goes into `AGENTS.md` under "Tooling decision records", WITH
that unblock condition. That is what turns a deferral into something a later sync can
check (`UPDATE.md` does exactly this) instead of an argument re-run from scratch every
few months, or — the actual failure — a repo quietly left behind.

`templates/tooling/eslint.config.mjs` exists for this outcome: a repo that assessed the
move and deferred it still deserves a good linter meanwhile. It requires TypeScript
< 6.1 (typescript-eslint's peer range stops there, and forcing the install past it
crashes ESLint at startup), which is itself a fact for the report — a repo on TypeScript
7 cannot defer the linter migration, because there is nothing to defer TO.

## The reviewer (auto-review)

The `ship` skill launches `.agents/auto-review.sh` after every PR it opens or updates: a
fresh session of a reviewer CLI — a DIFFERENT model family than the authoring tool, the
one hard rule — follows the `review` skill and posts the verdict comment, so the human
only reads verdicts. Detect the installed agent CLIs (`command -v` over `claude`, `codex`,
`agy`, `gemini`, and whatever the human mentions), report the list, and **ask which one
reviews** — reminding them it spends that CLI's quota on every `/ship`. No CLI installed,
or the human declines → do not install the script; reviews stay manual (`/review <n>`)
and nothing else changes.

Render `{{REVIEW_CMD}}` from the chosen CLI's OWN `--help`, never from memory. It must
reference `"$PR"`, instruct the CLI to read `.agents/skills/review/SKILL.md` and review
PR `#$PR` following it exactly, and **name the model explicitly** — a default model
drifts with releases and can silently break the cross-family rule. The script runs the
session on a visible cmux terminal, so it may be interactive.

Permissions — **enumerate what the protocol needs, plus a narrow deny**: list the tool
shapes a review actually uses (probe tests, mutation runs, the local gate, read-only
`git` and `gh`) in the CLI's permission config, and machine-deny `git push`,
`gh pr merge`, `gh pr close` in EVERY form the config distinguishes (sandboxed and
unsandboxed variants are separate rules in some CLIs).

**Never a wildcard allow.** "Grant broadly" is not "grant everything": a `*` rule makes
the deny list the ONLY boundary, and a prefix deny list is three command shapes — it does
not cover `gh api` (whose REST route merges a PR) or an argument-reordered
`git -C <dir> push`. seejs.app was adopted with `command(*)`, looked configured, and had
no second layer for six PRs.

Scope the run to the REVIEWER's worktree — `<repo>-wt-review`, a sibling of the main
checkout — with whatever the CLI offers (sandbox, workspace trust, allowed directories,
per-path file grants). Not the main checkout: it holds the author's uncommitted work,
the reviewer never runs there, and granting it both misses the directory that needs
granting and hands out the one that must not be. Never reach for a blanket permission
bypass — a bypass does not widen the toolset, it dissolves the boundary. Where the CLI
has a pre-tool-use hook, install it as a second, independent deny layer for the same
three commands: not an optional extra, since a skipped question here is a repo that can
never be given the layer later (`UPDATE.md` will not back-fill a hook file the repo does
not have).

**For agy this is all written out** — the ready-made hook guard, the `{{REVIEW_CMD}}`
shape, and the allowlist seeding (two grant forms, not one) — in `templates/agy/README.md`;
copy its shape when rendering for another CLI.

**Prove the render by RUNNING it**, and report both probes in the summary as
`[verified-by-execution]`:

1. Working probe: the rendered command against a harmless prompt or the repo's smallest
   real PR — it starts, reads the skill, runs a command, calls `gh pr list`, and never
   stalls on a question nobody can answer. One folder-trust question on the very first
   review is expected; a second prompt is a finding, not a quirk to answer by hand.
2. Deny probe: instruct the same session to run `git push --dry-run` — it must be REFUSED
   by the machine layer, not by the model's good manners.

**Re-run both probes whenever the way the reviewer is LAUNCHED changes** — a new CLI
version, different flags, a different terminal or workspace model — not only at adoption.
seejs.app moved its reviewer from headless to a cmux workspace in a later PR, nothing
required re-proving the run, and the regression (a permission prompt per file read)
shipped and survived two syncs.

## cmux (optional, detected)

Detect: `command -v cmux && CMUX_QUIET=1 cmux ping` — an installed binary whose socket is
silent counts as absent. What cmux changes when present:

- **auto-review** runs in a visible workspace `review #<pr>` beside the human's own —
  that is the script's design. Without cmux it fails loudly per launch and the
  `auto-review` status tells the human to run `/review <pr>` themselves: an honest
  outcome, not a bug to fix with a silent background fallback. Reviews share ONE worktree
  and therefore run one at a time; a second PR's workspace opens immediately and waits,
  saying "queued behind #N" in its `auto-review` status.
- **task workspaces**: the worktree module's `task:start` opens a two-pane workspace
  (agent + shell) when cmux answers; without it the git half still works.
- **verdict announcements are built in**: when the verdict comment lands, the launcher
  itself sends the desktop notification and, on an approve, opens the PR page as a
  background tab in the reviewer's workspace. Nothing to wire — behavior ships in the
  script, and the RUNBOOK only describes it.
- **What NOT to wire**: per-tool-call "ask" announcements. Against a properly seeded
  allowlist nothing stalls, and a notify per call blinks once per command for the entire
  review (nsarchive#129 learned this live). An announcement is only sane paired with a
  NARROW allowlist where an "ask" genuinely waits on a human — wire both or neither.
  Say this out loud in the summary, because the consequence is easy to read as a broken
  integration: **a running review is silent until its verdict lands.** Nothing announces
  that a session started, is queued, or is waiting on a question — the `auto-review`
  status on the PR is where a stalled review shows up, and the first review's
  folder-trust prompt is answered on the reviewer's own terminal.

## The worktree module (optional — ask)

Ask: "Do you want parallel tasks in git worktrees, each started and retired in one
command?" What it buys: `task:start <name> <branch>` cuts a fresh branch from the latest
default branch into a sibling worktree, provisions it (filtered `.env` + install), and
opens a cmux workspace where one is available; `task:finish <name>` retires it, refusing
to delete anything that could hold the only copy of work; `worktree:teardown --sweep`
reports leftovers and never deletes a branch on its own.

If yes: install the eight files into `scripts/` and wire `package.json` (Rule 0 applies
to an existing `scripts` block):

    "task:start": "node scripts/start-task.mts",
    "task:finish": "node scripts/finish-task.mts",
    "worktree:setup": "node scripts/setup-worktree.mts",
    "worktree:teardown": "node scripts/teardown-worktree.mts"

**If no — and the reviewer IS installed — say so in `docs/RUNBOOK.md`, in the same
breath.** `auto-review.sh` delegates every force-removal to this module and refuses to
`rm -rf` a directory it cannot judge, so without it the reviewer's leftovers are the
human's job: the launcher reports them (a desktop notification where cmux is present) and
stops there. A decline that leaves no line in the RUNBOOK is how two full checkouts sat
unnoticed in seejs.app. The line to write, adjusted to the repo's paths:
`git worktree remove --force <repo>-wt-review` when the reviewer's checkout is in the
way, and `git worktree prune` after.

Then ask which `.env` variables the local gate actually reads — the answer fills
`ALLOWED_ENV_VARS` in `scripts/worktree-utils.mts`. It ships EMPTY; every key added is a
declaration that every worktree, a reviewer's included, may see that value. Never offer
secrets; "none" is a common and correct answer. The module's two test files run under
vitest/jest where the repo has one; where it has neither, install them anyway and say the
safety net is dormant until a runner exists.

## Arm the hook, offer the settings

- `core.hooksPath` unset and no live hooks in `.git/hooks` →
  `git config core.hooksPath .githooks`, and offer
  `"prepare": "git config core.hooksPath .githooks"` in `package.json` — the setting is
  per-clone and never committed, so every fresh clone starts disarmed. Occupied → Rule 0.
- Offer squash-only merges:
  `gh api -X PATCH repos/{owner}/{repo} -F allow_squash_merge=true
  -F allow_merge_commit=false -F allow_rebase_merge=false -F delete_branch_on_merge=true`.
- Offer the package-manager cooldown — for pnpm, `minimumReleaseAge: 4320` plus
  `trustLockfile: true` in `pnpm-workspace.yaml` (without the latter, frozen-lockfile CI
  breaks on every security patch younger than the cooldown). No equivalent for this
  manager → say so and drop that RUNBOOK row.

Then point the human at **`SETUP.md`** — the GitHub side (merge settings, the branch
ruleset, Advanced Security, Actions hardening), ~10 minutes, and the ruleset step needs
one CI run to have happened first. Don't restate its contents.

## Verify the installation (re-run any time as a health check)

One line per check — `PASS`, `FAIL`, or `SKIP <reason>` — printed verbatim, never
summarized to "all good". A SKIP is not a pass.

1. The three skills are regular files under `.agents/skills/`, AND each
   `.claude/skills/<name>` is a symlink that resolves. A real directory there = FAIL (a
   second copy drifts).
2. `grep -rnE '\{\{[A-Z_][A-Z0-9_]*\}\}'` over everything installed — any hit = FAIL.
3. The hook is armed (`core.hooksPath` = `.githooks`, or the documented chain) and
   actually blocks, tested the way git runs it — exit 0 = FAIL, the lock permits:

       printf 'refs/heads/probe %s refs/heads/<default-branch> %s\n' \
         1111111111111111111111111111111111111111 \
         0000000000000000000000000000000000000000 \
         | SKIP_PUSH_GATE=1 sh .githooks/pre-push origin no-such-remote

4. ci.yml's steps match `package.json`'s gate scripts in BOTH directions, ci-docs.yml's
   job `name:` is byte-identical to ci.yml's, and the gate line in `AGENTS.md` and
   `docs/RUNBOOK.md` lists exactly those scripts — a gate line promising a linter the
   repo does not have is the version every future session will believe.
5. Merge settings via `gh api repos/{owner}/{repo}`: squash on, merge/rebase off,
   delete-branch-on-merge on.
6. Auto-review, where installed: executable, no placeholder, and the CLI its rendered
   command launches resolves in PATH.
7. Worktree module, where installed: the four `package.json` scripts exist, and
   `node scripts/setup-worktree.mts` from the MAIN checkout refuses with exit 1 — a
   refusal that names the right directory proves the script runs, with zero side effects.

## Summarize and offer the first commit

Print: what was written vs what existed and how each conflict was resolved; the detected
values (branch, package manager, test command, database yes/no, reviewer CLI or "reviews
stay manual", worktree module and its env allowlist); the clean-env build result as
something you RAN; both reviewer probes; what was declined (recorded as accepted); and
anything left aspirational. Then offer to commit — conventional title, no AI-attribution
trailers:

    chore(agents): adopt agent-playbook

Do not push. The human decides that.
