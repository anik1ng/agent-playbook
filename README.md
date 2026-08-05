# agent-playbook

A workflow where the human merges pull requests **without reading the diffs**.

That is the premise, not a failure mode. Reviewing every line of agent output is slower
than writing the code yourself, and doing it badly is worse than not doing it. So every
rule here replaces reading with a guarantee something else can make:

- **CI gates check the form.** Conventional PR title, a linked issue, a filled `## Docs`
  section — greps in a workflow, not requests in a document. A rule an agent must
  remember is a rule that gets skipped.
- **An independent reviewer checks the truth — by executing, not by reading.** A fresh
  session, from a *different model family* than the author, verifies the diff with
  throwaway probe tests and mutation runs, then posts its verdict as a comment on the PR.
  The verdict opens with `Reviewed-by: <tool / model family>, head <sha>`, so which family
  cleared which commit stays in the PR's history rather than in someone's memory. An author
  and a reviewer from the same family share blind spots; a review that stayed in the
  reviewer's transcript never happened.
- **Tests stay untouchable.** Weakening a test to get green removes the only machine
  guarantee the project has. Deleted, skipped or loosened tests without justification are
  reviewer blockers, always.

Extracted from a production Next.js project's agent workflow, then stripped of everything
project-specific. It is deliberately **not** a plugin, an installer, or a framework — it
is a set of files and one instruction document that any capable agent can follow.

## Install

In the repository you want to adopt it in, tell your agent:

> Read ADOPT.md from github.com/anik1ng/agent-playbook and install this workflow into the
> current repository.

That is the whole installation. `ADOPT.md` makes the agent detect the toolchain (npm /
pnpm / yarn / bun, test runner, build-time env, database), fill the templates in, and
refuse to overwrite anything that already exists without showing you a diff and asking.
It ends with a verification checklist that doubles as a health check you can re-run any
time.

Afterwards, [`SETUP.md`](SETUP.md) is your part: the one-time GitHub configuration —
merge settings, the branch ruleset with required status checks, Advanced Security,
Actions hardening. ~10 minutes, once per repository.

Bringing an already-adopted repository up to date later is the third operation,
[`UPDATE.md`](UPDATE.md), asked for the same way — *"Read UPDATE.md from
github.com/anik1ng/agent-playbook and sync this repository."*

## What lands in your repo

```
AGENTS.md                            the rules — one canonical file
docs/RUNBOOK.md                      the human's page: what YOU run and remember
.github/workflows/ci.yml             format, type-check, lint, build, test — one job
.github/workflows/ci-docs.yml        its no-op twin: keeps doc-only PRs mergeable under required checks
.github/workflows/pr-hygiene.yml     PR body links its issue, title is conventional, Docs filled
.github/workflows/security.yml       gitleaks secret scan on every PR
.github/dependabot.yml               grouped weekly bumps, supply-chain cooldowns
.github/pull_request_template.md
.githooks/pre-push                   the lock: no direct pushes to the default branch
.claude/settings.json                no AI-attribution trailers on commits/PRs
.agents/skills/do-issue/SKILL.md     issue → branch → implementation → PR
.agents/skills/ship/SKILL.md         rebase → local gate → push → PR
.agents/skills/review-pr/SKILL.md    the independent reviewer's checklist
.claude/skills/{do-issue,ship,review-pr}   symlinks → ../../.agents/skills/<name>
```

After adoption the skills are invoked as **`/do-issue <n>`**, **`/ship`** and
**`/review-pr <n>`** in Claude Code, and read directly as files by every other tool.

**Why `.agents/`.** It is the location Codex/ChatGPT and Antigravity/Gemini read
directly. Claude Code reads only `.claude/skills/`, but it follows a symlink there — hence
one real copy plus a symlink, rather than two copies that drift. This matters most for
`review-pr`: the one hard rule in `AGENTS.md` — **review comes from a different model
family than the author** — sends you to tools that cannot read anything vendor-specific.
A reviewer with nothing to read improvises a review and then reports that it followed
yours.

## One canonical file

`AGENTS.md` in the target repo owns every rule. The skills point at it and lose on drift:
where they disagree, the skill file is the bug.

The templates are a skeleton, not a config: `AGENTS.md` ships with a near-empty "Magnet
files" list, an empty "Never" list and empty decision records, on purpose. Fill them one
line at a time, each the day something actually breaks. A fresh repo carrying 200 lines of
someone else's incident history is cargo cult — the agent can't tell why the rules exist
and starts routing around them.

## What this does and does not do

**Two classes of file, and only one of them ever updates.** `AGENTS.md`, `ci.yml` and
`docs/RUNBOOK.md` become yours the moment they land: your `AGENTS.md` diverges from this
template the day you fill in your first magnet file, and that is the point — nothing here
ever touches those three again. The rest — the three skills, `pr-hygiene.yml`,
`security.yml`, `ci-docs.yml`, `dependabot.yml`, the PR template, the pre-push hook,
`.claude/settings.json` — carry nothing project-specific and are meant to stay identical
to these templates. When the playbook moves, [`UPDATE.md`](UPDATE.md) re-syncs exactly
that second class: it diffs them, shows you every difference before writing anything, and
lands the result as one PR.

**Node/TypeScript, GitHub, `gh` CLI.** The templates assume `package.json` scripts,
GitHub issues/PRs and a working `gh`. Other toolchains and forges: adapt by hand —
`ADOPT.md` tells the agent what each piece is for.

**Discovery is not verified for you.** Adoption checks that the symlinks resolve, but
whether a given tool actually picks a skill up is something only that tool can answer —
open a fresh session in each one you use and look. An agent asked whether it can see a
skill will say yes without checking.

## License

MIT — see [LICENSE](LICENSE).
