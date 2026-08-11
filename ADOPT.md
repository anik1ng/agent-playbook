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
- **Missing gate tools**: for every gate script the repo lacks, name a stack-appropriate
  candidate (eslint, prettier + `format:check`, `tsc --noEmit`) and ask ONE question —
  install now, or adopt without? Record declines in the summary as accepted, not
  forgotten.
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

Permissions — **allow-broad plus a narrow deny**: grant the tools the protocol needs
(probe tests, mutation runs, the local gate, `gh`) up front in the CLI's permission
config, and machine-deny `git push`, `gh pr merge`, `gh pr close` in EVERY form the
config distinguishes (sandboxed and unsandboxed variants are separate rules in some
CLIs). Scope the run to this working copy with whatever the CLI offers (sandbox,
workspace trust, allowed directories); never reach for a blanket permission bypass — a
bypass does not widen the toolset, it dissolves the boundary. Where the CLI also has a
pre-tool-use hook, offer it as a second, independent deny layer for the same three
commands.

**For agy this is all written out** — the ready-made hook guard, the `{{REVIEW_CMD}}`
shape, and the allowlist seeding (two grant forms, not one) — in `templates/agy/README.md`;
copy its shape when rendering for another CLI.

**Prove the render by RUNNING it**, and report both probes in the summary as
`[verified-by-execution]`:

1. Working probe: the rendered command against a harmless prompt or the repo's smallest
   real PR — it starts, reads the skill, runs a command, calls `gh pr list`, and never
   stalls on a question nobody can answer.
2. Deny probe: instruct the same session to run `git push --dry-run` — it must be REFUSED
   by the machine layer, not by the model's good manners.

## cmux (optional, detected)

Detect: `command -v cmux && CMUX_QUIET=1 cmux ping` — an installed binary whose socket is
silent counts as absent. What cmux changes when present:

- **auto-review** runs in a visible workspace `review #<pr>` beside the human's own —
  that is the script's design. Without cmux it fails loudly per launch and the
  `auto-review` status tells the human to run `/review <pr>` themselves: an honest
  outcome, not a bug to fix with a silent background fallback.
- **task workspaces**: the worktree module's `task:start` opens a two-pane workspace
  (agent + shell) when cmux answers; without it the git half still works.
- **the verdict tap**: fill the notification line in `docs/RUNBOOK.md` with
  `cmux notify --title "Review #<pr>" --body "VERDICT: …"`.
- **the approve tab**: add to the RUNBOOK's review ritual — on `VERDICT: approve` the
  reviewer also runs `cmux browser open "<pr-url>" --focus false`, so the approved PR is
  already open when the human switches over. Approve only; a blocker is the author's
  work, not something to park in a tab.
- **What NOT to wire**: per-tool-call "ask" announcements. Against a broad allowlist
  nothing stalls, and a notify per call blinks once per command for the entire review
  (nsarchive#129 learned this live). An announcement is only sane paired with a NARROW
  allowlist where an "ask" genuinely waits on a human — wire both or neither.

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

4. ci.yml's steps match `package.json`'s gate scripts in BOTH directions, and
   ci-docs.yml's job `name:` is byte-identical to ci.yml's.
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
