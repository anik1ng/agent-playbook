# ADOPT.md — how an agent installs this workflow

You are an agent, installing the agent-playbook workflow into the repository you are
currently in. The files to install are in this playbook's `templates/` directory — fetch
them with a shallow clone into a temporary directory (delete it when you are done):

    git clone --depth 1 https://github.com/anik1ng/agent-playbook <tmpdir>

If your current directory is not a git repository, stop and say so. Everything that needs
judgment — which toolchain this is, what to do about a file the repo already has — is a
conversation with the human, which is why this is a document and not a script.

## Rule 0 — existing files are the human's, not yours

This rule outranks every instruction below it. **Never overwrite an existing file or an
existing setting without showing the exact change and getting a yes.**

- Before writing to any destination that already exists: render your version somewhere
  temporary, show the human `diff -u <their file> <your render>`, and ask — keep theirs,
  take yours, or merge by hand. One file at a time; wait for the answer per file.
  `AGENTS.md` and the workflow files are the ones people already have; expect to hit this.
- The same applies to settings: never change an occupied `core.hooksPath` (step 4), and
  never replace an existing `.claude/settings.json` — merge into it (step 3).
- A destination that does not exist yet, you may write without asking.

## 1. What you are installing

Fourteen files plus three symlinks (one file conditional — `auto-review.sh` is installed
only when the "Reviewer CLI" detection in step 2 ends with the human choosing one):

| Template                      | Destination                          |
| ----------------------------- | ------------------------------------ |
| `AGENTS.md`                   | `AGENTS.md`                          |
| `RUNBOOK.md`                  | `docs/RUNBOOK.md`                    |
| `pull_request_template.md`    | `.github/pull_request_template.md`   |
| `workflows/ci.yml`            | `.github/workflows/ci.yml`           |
| `workflows/ci-docs.yml`       | `.github/workflows/ci-docs.yml`      |
| `workflows/pr-hygiene.yml`    | `.github/workflows/pr-hygiene.yml`   |
| `workflows/security.yml`      | `.github/workflows/security.yml`     |
| `dependabot.yml`              | `.github/dependabot.yml`             |
| `githooks/pre-push`           | `.githooks/pre-push` (chmod 755)     |
| `settings.json`               | `.claude/settings.json`              |
| `skills/do/SKILL.md`          | `.agents/skills/do/SKILL.md`         |
| `skills/ship/SKILL.md`        | `.agents/skills/ship/SKILL.md`       |
| `skills/review/SKILL.md`      | `.agents/skills/review/SKILL.md`     |
| `scripts/auto-review.sh`      | `.agents/auto-review.sh` (chmod 755) |

Then the symlinks — RELATIVE, never absolute, so they survive the repo being cloned to a
different path: `.claude/skills/<name>` → `../../.agents/skills/<name>`, for each of the
three skills.

`.agents/` is the vendor-neutral location, read directly by Codex/ChatGPT and by
Antigravity/Gemini; Claude Code reads only `.claude/skills/` but follows a symlink out of
it. One real copy, one symlink, nothing to keep in sync. Do NOT create `.gemini/`,
`.agent/`, `.codex/` or any other per-vendor directory — each one is a copy that will
drift. If `.claude/skills/<name>` already exists as a real directory, that is Rule 0
territory: it is either the human's own skill or a committed second copy of a protocol —
say which you think it is and ask. Never delete it to make room for the symlink.

The templates carry placeholders. Four are inline substitutions — `{{DEFAULT_BRANCH}}`,
`{{PKG_MANAGER}}`, `{{INSTALL_CMD}}`, `{{TEST_CMD}}` — and two stand alone on a line of
their own and are replaced by a whole indented block, or the line is deleted entirely:
`{{DB_SERVICE_BLOCK}}`, `{{BUILD_ENV_BLOCK}}`. One more, `{{REVIEW_CMD}}` in
`auto-review.sh`, stands alone on a line and is replaced by the reviewer CLI command the
"Reviewer CLI" detection renders. When you are done, no `{{...}}` token may survive in
anything you wrote.

## 2. Detect — and report what you found before writing anything

**Default branch** → `{{DEFAULT_BRANCH}}`:

    gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null \
      || git symbolic-ref --short HEAD

**Package manager** → `{{PKG_MANAGER}}` and `{{INSTALL_CMD}}`, from the lockfile in the
repo root. First match wins:

| Lockfile                 | `{{PKG_MANAGER}}` | `{{INSTALL_CMD}}`                |
| ------------------------ | ----------------- | -------------------------------- |
| `pnpm-lock.yaml`         | `pnpm`            | `pnpm install --frozen-lockfile` |
| `yarn.lock`              | `yarn`            | `yarn install --immutable`       |
| `bun.lock` / `bun.lockb` | `bun`             | `bun install --frozen-lockfile`  |
| `package-lock.json`      | `npm`             | `npm ci`                         |
| none                     | `npm`             | `npm install`                    |

- **bun**: `actions/setup-node`'s `cache:` has no `bun` value — in the rendered `ci.yml`,
  replace the `corepack enable` + `actions/setup-node` pair with `oven-sh/setup-bun@v2`
  and drop the `cache:` line. Ask before doing it.
- **none**: this row costs twice — `setup-node`'s `cache:` fails outright without a
  lockfile (`Dependencies lock file is not found`), and `npm install` re-resolves the
  whole tree on every run, which is the hole the cooldown policy exists to close. Offer to
  commit a lockfile before adopting; that fixes both. If the human declines, delete the
  `cache:` line, say you did, and say plainly that CI now installs unpinned dependencies.
- **`packageManager` field** (pnpm and yarn): `ci.yml` runs `corepack enable`, and
  corepack takes the version from this `package.json` field. Without it corepack does not
  fail — it silently uses its own known-good release instead of the version the lockfile
  was written by. Check for the field; if missing, offer to pin it to the locally
  installed version (`pnpm --version` → `"packageManager": "pnpm@x.y.z"`). npm needs
  nothing here.

**Test runner** → `{{TEST_CMD}}`. Read `package.json` `scripts`:

- a `test` script exists → `<pkg-manager> test`
- no `test` script, but vitest/jest/node:test is a dependency → propose the direct command
  (e.g. `pnpm exec vitest run`) and ask
- no tests at all → say so plainly. Drop the test step from the rendered `ci.yml`, note in
  the summary that the "Tests are the safety net" section of `AGENTS.md` is currently
  aspirational, and fill `{{TEST_CMD}}` in `AGENTS.md`/`RUNBOOK.md` with the command the
  repo SHOULD grow, marked as such. Do not invent a fake passing command.

**Build script**: if `package.json` has no `build` script, drop the Build step (and its
`{{BUILD_ENV_BLOCK}}` line) from the rendered `ci.yml` and say you did.

**Static gate scripts**: read `package.json` `scripts` for `format:check`, `type-check`
and `lint`. **Delete the `ci.yml` step for every one the repo does not define**, and say
which you deleted — a step calling a missing script is `Missing script`, a hard failure,
and it lands on the human's first run of a workflow they just adopted. Do not make steps
tolerant instead (`--if-present` and friends): a step that no-ops when the script is
absent also no-ops when someone renames `type-check` to `typecheck`, and then the gate is
green and checking nothing. Update the job's `name:` to list only the steps that remain —
it is the label the human marks as a required status check — and mirror the exact same
`name:` into `workflows/ci-docs.yml`: the no-op twin must report under the identical name
(the comment in that file explains the mechanism). Apply the same deletion to the
local-gate command line in `AGENTS.md` ("Getting to master") and `docs/RUNBOOK.md`.
`.githooks/pre-push` needs no editing — it looks these scripts up at push time — but tell
the human: a script added later starts gating in the hook by itself and never reaches CI
until someone adds the step (the Verify checklist below catches that drift).

**`.nvmrc`**: `ci.yml` uses `node-version-file: .nvmrc`. If the repo has none, create one
containing the major version of the local `node -v`, and say you did.

**Build-time env** → whether the Build step needs an `env:` block. This is the one
detection you cannot do by reading — run it, in an environment that mimics the runner's:
take the variable names from `.env.example` (or `.env`) and run the build with every one
set to **empty** (`DATABASE_URL= SOME_API_KEY= <pkg-manager> run build`). An
explicitly-empty value survives framework env loaders (they do not override variables
already in `process.env`), so this reproduces "the runner has no `.env`" without touching
the human's real one.

- Build passes → no block needed. Say so; it is a real fact worth reporting.
- Build fails naming a variable → that name goes into `{{BUILD_ENV_BLOCK}}`, taken from
  the error, not from a guess. Re-run until green; variables often surface one at a time.
  The block is step-level, deliberately — a build dummy leaking into the test step makes
  tests pass against nothing (`env:` at 8 spaces, keys at 10):

              env:
                # CI compiles only. Never used at runtime, never connects to
                # anything — a real value here would be a leaked secret.
                DATABASE_URL: postgresql://ci:ci@localhost:5432/ci_unused

- If a build-time throw shows up, mention once that making the module create its client
  lazily fixes it at the root and needs no CI dummies — but do not refactor their code as
  part of adoption.

Do this BEFORE the human's first PR: a red first CI run on a freshly adopted workflow
reads as "the setup is broken" and costs a debugging session to disprove.

**Database** → whether `ci.yml` needs a service container. Evidence: a
`docker-compose.y*ml` with a postgres/mysql service, `DATABASE_URL` in `.env.example`, a
`pg`/`mysql2`/`prisma`/`drizzle-orm` dependency. Report the evidence and ask — a false
positive bills a service container on every run. If yes, `{{DB_SERVICE_BLOCK}}` (siblings
of `runs-on:`, so 4 spaces; keep the image major in sync with production; adapt for MySQL):

        services:
          postgres:
            image: postgres:18
            env:
              POSTGRES_USER: ci
              POSTGRES_PASSWORD: ci
              POSTGRES_DB: ci_test
            ports:
              - 5432:5432
            options: >-
              --health-cmd "pg_isready -U ci"
              --health-interval 5s
              --health-timeout 5s
              --health-retries 10
        env:
          DATABASE_URL: postgresql://ci:ci@localhost:5432/ci_test

When the job has a database service, the Build step inherits that job-level
`DATABASE_URL` and needs no dummy for it — only for variables the service does not provide.

**Reviewer CLI** → `{{REVIEW_CMD}}` in `auto-review.sh` — whether reviews can start
themselves. The `ship` skill launches `.agents/auto-review.sh` after every PR it opens or
updates: one headless session of a reviewer CLI that follows the `review` skill and posts
the verdict comment, so the human only reads verdicts. This detection ends in a question,
never an assumption:

- Detect which agent CLIs are installed (`command -v` over the ones you know — `claude`,
  `codex`, `agy`, `gemini`, and whatever else the human mentions), report the list, and
  **ask the human which should run automatic reviews** — reminding them of the one hard
  rule: the reviewer should be a DIFFERENT model family than the tool that authors their
  PRs. The human's answer also settles quota: automatic reviews spend that CLI's paid
  quota on every `/ship`.
- Render `{{REVIEW_CMD}}` from the chosen CLI's OWN `--help`, not from memory or guides —
  headless flags churn. The rendered line must reference `"$PR"` (the script's variable),
  run non-interactive/headless, instruct the CLI to read `.agents/skills/review/SKILL.md`
  and review PR `#$PR` following it exactly, and carry the model/effort flags the human
  wants for reviews.
- Permissions, two-sided by design: the headless run needs approvals wide enough for the
  full protocol (probe tests, mutation runs, the local gate, `gh`) — a soft-denied tool
  does not stop the review, it silently hollows it into read-only — while the
  irreversible stays machine-denied: configure the CLI's own permission settings to deny
  `git push`, `gh pr merge` and `gh pr close`. If the chosen CLI has no deny mechanism,
  say so plainly and let the human decide whether prose ("the reviewer never pushes" in
  the `review` skill) is enough for them.
- No CLI installed, or the human declines → do not install `.agents/auto-review.sh` at
  all. The `ship` skill skips the absent script silently; reviews stay manual
  (`/review <n>` in a fresh session), and the summary in step 8 says so.

## 3. Write the files

Under Rule 0, render and place everything from the table in step 1, then create the three
symlinks. Two files get special treatment:

- **`.claude/settings.json`**, when it already exists: the template sets only
  `attribution` (suppresses the `Co-Authored-By` trailer and the PR byline — the machine
  form of the prose rule in `AGENTS.md`). Do not offer "take the template" as an
  overwrite: show the human their existing JSON with the `attribution` object merged in,
  and write THAT if they agree.
- **`CLAUDE.md`**, when the repo has none: offer to create one containing only
  `@AGENTS.md` — one source of truth, loaded automatically in Claude Code. (If the human
  uses another tool with a wrapper file — `GEMINI.md` — same offer, same one line.)

## 4. Arm the hook — without taking anything over

git reads ONE hook directory. Pointing `core.hooksPath` at `.githooks` when another
manager owns it is a replacement, not an addition — it would silently kill `commit-msg`,
`lint-staged`, everything. So:

- `core.hooksPath` unset and `.git/hooks` has no live hooks → run
  `git config core.hooksPath .githooks`, `chmod 755 .githooks/pre-push`, and say so.
- `core.hooksPath` already set to something else (husky, lefthook), or real hooks live in
  `.git/hooks` → **do not touch it.** Say plainly: until this is resolved, nothing blocks
  a direct push to the default branch. Two ways out, the human picks:
  1. **Keep their manager, chain to ours** — their `pre-push` calls
     `sh .githooks/pre-push "$@" < /dev/stdin` (the hook reads pushed refs from stdin).
     Both gates run; nothing they had is lost.
  2. **Move the lock into their directory** — copy `.githooks/pre-push` in, merging with
     whatever is there.
- `core.hooksPath` is per-clone and never committed — every clone and worktree starts
  disarmed. Offer to add `"prepare": "git config core.hooksPath .githooks"` to
  `package.json` so the package manager arms it on install (only in the unset case above).

## 5. Repo settings to offer — ask, then run, then report

- **Squash-only merges** — "the PR title becomes the commit title" depends on it:

      gh api -X PATCH repos/{owner}/{repo} \
        -F allow_squash_merge=true -F allow_merge_commit=false \
        -F allow_rebase_merge=false -F delete_branch_on_merge=true

- **Package-manager cooldown** — the local half of the supply-chain policy (3 days
  minor/patch, 14 majors; the server half is already in `dependabot.yml`). For pnpm, in
  `pnpm-workspace.yaml`: `minimumReleaseAge: 4320` plus `trustLockfile: true` — without
  the latter, `--frozen-lockfile` in CI breaks every time a security patch lands younger
  than the cooldown. If the manager has no equivalent, say so and delete that row from
  `docs/RUNBOOK.md` rather than leaving the doc describing a setting nobody made.

If the human declines either, put it on the checklist below instead of dropping it.

## 6. Point the human at SETUP.md

The GitHub-side configuration — merge settings, the branch ruleset with required status
checks, Advanced Security toggles, Actions hardening, the one-time secret sweep — is the
human's one-time task with its own page: **`SETUP.md` in this playbook.** Print its
location, say it takes ~10 minutes, and note that the ruleset step needs one CI run to
have happened first (the status-check names must exist in the picker). Do not restate its
contents — one canonical copy.

Two things stay on your checklist here, because they are not GitHub settings:

- [ ] **Orchestrator setup/teardown** — only if the human develops in git worktrees:
      per-worktree setup installs deps and provisions that worktree's own disposable test
      database; the delete script drops it. Write both as `package.json` scripts.
- [ ] **Fill in `AGENTS.md` over time** — the "Magnet files" list ships with one entry
      (`ci.yml`); add the next the first time two PRs actually collide, not before. Same
      for "Never" and the decision records. A fresh repo carrying 200 lines of someone
      else's incident history is cargo cult.

Then, optional and deliberately not automated — one line each, install none unasked:
strict type-aware linting (`typescript-eslint` strictTypeChecked); a whole-graph dead-code
gate (`knip`, only if you commit to zero findings); an e2e smoke spec (Playwright, one
happy path, as a tail step on the existing `checks` job — never its own job).

## 7. Verify the installation

Run this after adopting — and re-run it any time (fresh clone, new worktree, "something
feels off"): it is the health check for this workflow. One line per check — `PASS`,
`FAIL`, or `SKIP <reason>`; print them verbatim, never summarize to "all good". A SKIP is
not a pass: say which checks did not run. Fix what you may under Rule 0; anything else is
a finding for the human.

1. **Skills resolve, as symlinks**: for each of the three, `.agents/skills/<name>/SKILL.md`
   is a regular file AND `.claude/skills/<name>` is a symlink whose `SKILL.md` resolves. A
   real directory where the symlink should be = FAIL (a second copy drifts).
2. **No surviving placeholders**: `grep -rnE '\{\{[A-Z_][A-Z0-9_]*\}\}'` over every file
   from the step-1 table that exists. Any hit = FAIL.
3. **The hook is armed and actually blocks**: `.githooks/pre-push` is executable;
   `core.hooksPath` is `.githooks` (or the documented chain from step 4 is in place). Then
   test the lock by RUNNING it the way git does — presence proves nothing:

       printf 'refs/heads/probe %s refs/heads/<default-branch> %s\n' \
         1111111111111111111111111111111111111111 \
         0000000000000000000000000000000000000000 \
         | SKIP_PUSH_GATE=1 sh .githooks/pre-push origin no-such-remote

   Exit 0 = FAIL — the lock runs and permits. Also check the hook's `PROTECTED_BRANCH`
   equals the actual default branch: renaming it disarms the hook without touching a line
   of its logic.
4. **The two gates agree**: the scripts `ci.yml` runs (`format:check`, `type-check`,
   `lint`) versus the ones `package.json` defines — a step for a missing script = FAIL
   (red CI); a defined script with no CI step = FAIL (the hook gates it locally, CI never
   sees it).
5. **Merge settings**: via `gh api repos/{owner}/{repo}` — squash on, merge/rebase off,
   delete-branch-on-merge on. SKIP with the reason if `gh` or access is missing — a repo
   where this always skips is a repo whose merge settings nobody has ever verified.
6. **Auto-review, where installed**: `.agents/auto-review.sh` is executable, carries no
   placeholder, and the CLI its rendered command launches resolves in PATH. SKIP with the
   reason where the repo chose manual reviews — that is a valid choice, not a failure.

## 8. Summarize and offer the first commit

Print, in order: what was written vs what existed and how each conflict was resolved; the
detected values (branch, package manager, test command, database yes/no, reviewer CLI or
"reviews stay manual"); the clean-env
build result as something you RAN, with the outcome; which settings were applied and which
declined; anything left aspirational (no tests, no build, bun). Then offer to commit —
conventional title, no AI-attribution trailers:

    chore(agents): adopt agent-playbook

Do not push. The human decides that.
