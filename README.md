# agent-playbook

A workflow where the human merges pull requests **without reading the diffs**.

That is the premise, not a failure mode. Reviewing every line of agent output is slower
than writing the code yourself, so every rule here replaces reading with a guarantee
something else can make:

- **CI gates check the form** — conventional PR title, a linked issue, a filled `## Docs`
  section: greps in a workflow, not requests in a document.
- **An independent reviewer checks the truth — by executing, not by reading.** A fresh
  session from a *different model family* than the author verifies the diff with probe
  tests and mutation runs, then posts its verdict as a PR comment opening with
  `Reviewed-by: <tool / model family>, head <sha>`.
- **Tests stay untouchable.** Weakening a test to get green removes the only machine
  guarantee the project has.

Deliberately **not** a plugin, an installer, or a framework — a set of template files and
three instruction documents any capable agent can follow.

## The three operations

In the repository you want to adopt it in, tell your agent:

> Read ADOPT.md from github.com/anik1ng/agent-playbook and install this workflow into the
> current repository.

- **`ADOPT.md`** (once, the agent's part): detects the toolchain, renders the templates,
  refuses to overwrite anything without showing a diff, and ends with a re-runnable
  health check.
- **`SETUP.md`** (once, your part): the GitHub-side configuration — merge settings, the
  branch ruleset with required checks, Advanced Security. ~10 minutes.
- **`UPDATE.md`** (whenever the playbook moves): in an adopted repo the whole
  instruction is **`/playbook-update`** — the skill reads `.agents/playbook.lock`,
  fetches the playbook, and answers "up to date" in seconds or reports exactly what
  moved upstream before syncing. Repos adopted before the skill existed still use the
  sentence: *"Read UPDATE.md from github.com/anik1ng/agent-playbook and sync this
  repository."* Either way it syncs the files that never diverge, keeps the ones that
  do, and shows every difference before writing.

A fourth operation runs on no schedule but keeps the whole thing healthy:
**`/playbook-compact`** — the accumulated memory files (`CLAUDE.md`, `AGENTS.md`,
`docs/RUNBOOK.md`) grow a rule per incident and nothing ever removes, so periodically
this skill compresses them mercilessly — reasoning and narrative go, live rules and
decision verdicts stay, git keeps everything deleted — in its own reviewed PR.

## What lands in your repo

```
AGENTS.md                          the rules — one canonical file (yours after adoption)
docs/RUNBOOK.md                    the human's page: what YOU run and remember (yours)
.github/workflows/ci.yml           the gate: format, types, lint, build, tests (yours)
.github/workflows/ci-docs.yml      its no-op twin: keeps doc-only PRs mergeable
.github/workflows/pr-hygiene.yml   PR body links an issue, title is conventional, Docs filled
.github/workflows/security.yml     gitleaks secret scan on every PR
.github/dependabot.yml             grouped weekly bumps, supply-chain cooldowns
.github/pull_request_template.md
.githooks/pre-push                 the lock: no direct pushes to the default branch
.claude/settings.json              no AI-attribution trailers; allows the reviewer launch
.agents/skills/*/                  the protocols (do, ship, review, playbook-update,
                                   playbook-compact); .claude/skills/* symlink to them
.agents/playbook.lock              which playbook commit this repo is synced to
.agents/auto-review.sh             optional: /ship starts the cross-family reviewer itself
scripts/*.mts                      optional worktree module: task:start / task:finish / worktree:gc
scripts/schema-lock*.mts           optional: one-schema-branch-at-a-time, enforced not remembered
```

**`/do <n>` is the one command to remember.** It reads the issue and decides what it
needs: a small fix goes straight to implementation; a substantial issue with no spec
turns the session into a brainstorm that writes the spec and the plan (committed, so
design gets the same review as code), files the plan's phases as sub-issues, and stops —
implementation then runs in fresh sessions, one `/do` per sub-issue. `/ship` takes a
finished branch to a PR and launches the auto-review; `/review <n>` is the manual form of
the same reviewer pass.

**The review starts itself.** With a reviewer CLI chosen at adoption (a different model
family than the tool writing your PRs), `/ship` opens a visible cmux workspace
`review #<pr>` beside yours: the reviewer works in its own worktree, posts the verdict
comment, and an `auto-review` commit status on the PR tracks the run. Your part shrinks
to reading verdicts and merging. cmux is what makes this automatic — skip either at
adoption and reviews stay manual, with nothing else changed.

**Why `.agents/`**: Codex/ChatGPT and Antigravity/Gemini read it directly; Claude Code
reads `.claude/skills/`, which symlinks into it. One real copy, nothing to drift — and
the review protocol must be readable by a tool from another vendor, which is the point.

**Assumptions**: Node/TypeScript; GitHub with a working `gh`; and cmux — the workspace
manager this workflow's automation is built around: the automatic reviewer and task
workspaces require it, and without it reviews are manual (`/review <n>`) and worktrees
are plain git. Other toolchains and forges: the templates say what each piece is for;
adapt with judgment.

`AGENTS.md` in the target repo owns every rule; the skills point at it and lose on drift.
Its lists (magnet files, "Never", decision records) ship nearly empty on purpose — fill
them one line at a time, each the day something actually breaks. A fresh repo carrying
someone else's incident history is cargo cult.

## License

MIT — see [LICENSE](LICENSE).
