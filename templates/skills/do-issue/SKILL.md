---
name: do-issue
description: Take a GitHub issue in this repo from kickoff to pull request — read the rules and the issue, get on the right branch, implement, ship. Use when asked to work on, implement, pick up or fix an issue by number, whichever tool you are.
argument-hint: <issue-number>
---

**The issue number you were invoked with: #$ARGUMENTS.** Below, `<issue>` means that number.
If the line above reads back as a literal `$ARGUMENTS`, your tool does not substitute
arguments — take the number from the request that invoked you and carry on.

You are implementing issue #`<issue>` in this repo, end to end: rules, branch,
implementation, PR. This file is the executable form of the kickoff ritual the human
otherwise types by hand every session.

**`AGENTS.md` in THIS repo is canonical.** This file never restates a rule it could point
at — where the two disagree, AGENTS.md wins and this file is the bug. Work the steps in
order.

## 1. Read the rules

Read `AGENTS.md` in full, now, before anything else. (Your tool may also load a wrapper —
`CLAUDE.md`, `GEMINI.md` — that only `@`-includes `AGENTS.md`; that is not a substitute for
reading it.) You are about to make branch, test and PR decisions that all live in there.

If the repo has no `AGENTS.md`, say so and stop — this workflow is installed by following
`ADOPT.md` from the playbook repository. Everything below assumes it exists.

## 2. Read the issue — body AND comments

    gh issue view <issue> --json number,title,body,state,labels,comments

**The comments are part of the spec.** Amendments, scope cuts and reversals land there, and
a later comment supersedes the body where they conflict — read every one and implement the
resolved shape, not the body's first draft.

If the issue is multi-part (several independent deliverables, or it says "one PR per X"):
ask the human which part, unless the issue states the parts are ordered — then take the
first unclaimed one. One branch = one PR = one logical change (AGENTS.md "Branch
discipline").

If the issue leaves a decision explicitly open ("decide whether X"), that is a question for
the human, not a coin flip — ask it before writing the code that depends on the answer.

Derive the branch name you would use from the issue's conventional-commit title prefix:
`chore(agents): …` → `chore/<kebab-short-name>`. Step 3 may not need it.

## 3. Get on the right branch — adopt before you create

Detect the default branch rather than assuming its name:

    DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)

Someone may have already made a branch for this task — a worktree tool, a task runner, or
the human by hand. **Never provision what already exists.** First matching case wins:

    git fetch origin --prune
    git status -sb
    git log --oneline origin/$DEFAULT..HEAD

1. **On the default branch** → `git switch -C <type>/<kebab> origin/$DEFAULT`. A dirty tree
   is fine: `switch -C` carries uncommitted changes onto the new branch (this is the
   "started hacking on the default branch, now formalize it" case).
2. **On a non-default branch with no commits beyond `origin/$DEFAULT`** → that is a fresh
   task branch someone else already cut. **Adopt it as-is, whatever it is called.** Branch
   names carry no meaning downstream — the PR title becomes the squash title.
3. **On a non-default branch WITH commits beyond `origin/$DEFAULT`** → ask that branch about
   its PR: `gh pr view --json state,mergedAt` (no argument = current branch).
   - **merged or closed** → leftover history after a squash-merge (a squashed branch's
     commits are never ancestors of the default branch). Routine, not an anomaly: silently
     `git switch -C <type>/<kebab> origin/$DEFAULT` and carry on. No question to the human.
     Same rule as AGENTS.md "never reuse a branch after merge".
   - **open** → in-flight work belonging to someone else. **STOP and ask the human.**
   - **no PR at all** → unshipped local work of unknown provenance. **STOP and ask the
     human.**

Never `git branch -D` anything. `switch -C <new-name>` leaves the old ref behind; deleting
branches is a human action (AGENTS.md "Never").

**Environment guard, not setup:** if the working copy is missing its local environment
(uninstalled dependencies, an absent local env file the repo's setup script writes), run
the repo's documented setup command once — AGENTS.md names it. If the environment is
already there, touch nothing.

## 4. Magnet-file overlap check

If the issue's work touches any file on the AGENTS.md "Magnet files" list, check open PRs
for overlap BEFORE you start writing:

    gh pr list --state open --json number,title,files

If an open PR touches the same file, **STOP and ask the human who goes first.** Don't guess,
don't race. This step is restated here because it is the one agents skip.

Also check AGENTS.md for a one-branch-at-a-time rule (schema/migrations are the usual case):
where the repo has one, the generated artifact ships in the SAME PR as its source change.

## 5. Implement

Follow the issue's spec, and AGENTS.md for how:

- **Test-first for behavioural changes** ("Tests are the safety net") — a regression test
  that FAILS on current code, then the fix, then green. Where test-first genuinely doesn't
  apply (docs, config, pure deletion, indexes, logging), plan to say so explicitly in the PR
  body instead of writing a fake test.
- Never delete, `.skip`, weaken or mock away an existing test to get green.
- If AGENTS.md carries project-specific rule sections for what this diff touches, they are
  blocker lists, not advice. Read them before writing, not after.
- Commit as you go, in logical well-scoped commits, following AGENTS.md "Workflow" on
  whether that needs approval.

## 6. Ship

Follow the `ship` skill (`/ship`, or read `.agents/skills/ship/SKILL.md` directly): rebase
onto the default branch, full local gate, push, PR.

Two things `ship` deliberately makes you write yourself, with one default from this issue:

- **Issue link:** `Closes #<issue>` — unless this issue is an umbrella / multi-part one
  that must stay open across several PRs, in which case `Refs #<issue>`.
- **`## Docs`:** written fresh, never boilerplate. Answer the real question — which docs does
  this diff make stale, or why genuinely none.
