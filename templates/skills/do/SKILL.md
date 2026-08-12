---
name: do
description: Take a GitHub issue in this repo to its next stage, end to end — read the rules and the issue, decide whether it needs a spec and a plan first, run that session when one is missing, otherwise branch, implement, ship. Use when asked to work on, implement, pick up, spec out or fix an issue by number, whichever tool you are.
argument-hint: <issue-number>
---

**The issue number you were invoked with: #$ARGUMENTS.** Below, `<issue>` means that number.
If the line above reads back as a literal `$ARGUMENTS`, your tool does not substitute
arguments — take the number from the request that invoked you and carry on.

You are taking issue #`<issue>` in this repo to its next stage. `/do` is a dispatcher:
the same command serves every stage of an issue's life — a two-line seed becomes a spec
and a plan, a specced issue becomes code, a small fix goes straight to a PR — and step 3
decides which of those this session is. This file is the executable form of the kickoff
ritual the human otherwise types by hand every session.

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
`chore(agents): …` → `chore/<kebab-short-name>`. Step 4 may not need it.

## 3. Stage gate — what does this issue need next?

Decide which session this is, on TWO axes — size and uncertainty. An issue is a SEED, not
a spec — two lines and a title is a valid issue; this step is where it grows.

- **Size.** The threshold lives in AGENTS.md ("Specs and plans", where the repo carries
  that section); the default where it doesn't: work is **substantial** when it takes more
  than one PR to land, introduces a new entity or subsystem, makes an architectural
  decision, or changes a schema. When unsure, it is substantial.
- **Uncertainty.** Is there a decision here the human has not made — a choice between
  approaches with real trade-offs, a shape the issue names but does not fix, a "should it
  also…" you would otherwise answer for them? Size does not answer this: a one-PR change
  can rest entirely on an unmade decision, and implementing it is guessing with a
  keyboard. Do NOT wait to be asked for a design conversation; the human writing "needs a
  spec" on the issue is this gate's job outsourced back to them.

**Say the verdict in one line before acting on it** — "Stage gate: small and settled,
implementing" / "small but there's an open choice: …" / "substantial, this is the
spec+plan session". Every branch below is silent about itself otherwise, and a session
that never ran the gate looks exactly like one that ran it and chose to implement.

1. **Small and settled** → continue to step 4 and implement. (If the human wrote "no spec
   needed" on the issue, believe them.)

   **Small but unsettled** → do not open a spec, and do not guess either: ask HERE, in
   this session, before the code. Questions one at a time, each with the options and what
   they cost; propose the one you would pick. When the shape is agreed, write it as a
   COMMENT on the issue (a short "decided: …", so the next session and the reviewer inherit
   it) and continue to step 4 in the same session. This branch is deliberately cheap — no
   spec file, no plan, no sub-issues, no fresh session. It exists because most unmade
   decisions cost one exchange, and the full ceremony below is too heavy to be worth
   reaching for, so it never gets reached for.
2. **Substantial, and the issue or its comments link a committed spec** → read the spec
   AND its plan before any code; on the shape of the work they outrank both the issue's
   own prose and your ideas. Then continue to step 4.
3. **Substantial, and no spec exists** → this session is the SPEC+PLAN session, and it
   will not implement. Announce that, then:

   - **Brainstorm first.** If a dedicated brainstorming skill is installed (e.g.
     `superpowers:brainstorming`), use it — it already knows the rest of this stage.
     Fallback protocol: explore the project context; ask the human clarifying questions
     ONE AT A TIME; propose 2–3 approaches with trade-offs and a recommendation; get the
     design approved section by section before writing the doc. Never skip the interview —
     the conversation IS the point of this stage.
   - **Write the spec** — `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`: the
     problem, the decisions made, the alternatives rejected and why. Every claim about
     platform behavior carries its evidence class (AGENTS.md "Specs and plans" defines
     the three labels) — and `[verified-by-execution]` is earned by executing, during
     this session, not by confidence. Then the **plan**,
     same session (`superpowers:writing-plans` where installed) —
     `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`: bite-sized tasks grouped into
     phases, each phase sized to ONE PR, written for an engineer with zero context.
   - **Decompose into sub-issues** — one per phase (`gh issue create`), each linking the
     spec and carrying `Refs #<issue>`. Edit the seed issue into the umbrella: a task-list
     checklist of the sub-issues in its body, plus a comment linking the spec and plan.
     The docs are the snapshot of the decisions; the umbrella issue is the live state.
   - **Ship the artifacts** — the spec + plan (and nothing else) as one PR via step 7,
     with `Refs #<issue>` as the issue link. The spec riding a PR is deliberate: it gets
     the same independent review as code, and spec errors are the expensive ones.
   - **Stop.** Tell the human: the spec and plan are up for review, and implementation
     starts in a FRESH session with `/do <first sub-issue>`. Do not implement here — the
     docs are the compression of this session's context, and a fresh executor reading
     them beats a long session dragging the whole brainstorm behind it (AGENTS.md
     "Model routing": spec work and execution are different tiers, hence different
     sessions).

## 4. Get on the right branch — adopt before you create

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

## 5. Magnet-file overlap check

If the issue's work touches any file on the AGENTS.md "Magnet files" list, check open PRs
for overlap BEFORE you start writing:

    gh pr list --state open --json number,title,files

If an open PR touches the same file, **STOP and ask the human who goes first.** Don't guess,
don't race. This step is restated here because it is the one agents skip.

Also check AGENTS.md for a one-branch-at-a-time rule (schema/migrations are the usual case):
where the repo has one, the generated artifact ships in the SAME PR as its source change.

## 6. Implement

Follow the issue's spec — and where step 3 found a committed spec and plan, execute the
plan's tasks for THIS issue's phase in order — and AGENTS.md for how:

- **Test-first for behavioural changes** ("Tests are the safety net") — a regression test
  that FAILS on current code, then the fix, then green. Where test-first genuinely doesn't
  apply (docs, config, pure deletion, indexes, logging), plan to say so explicitly in the PR
  body instead of writing a fake test.
- Never delete, `.skip`, weaken or mock away an existing test to get green.
- If AGENTS.md carries project-specific rule sections for what this diff touches, they are
  blocker lists, not advice. Read them before writing, not after.
- Commit as you go, in logical well-scoped commits, following AGENTS.md "Workflow" on
  whether that needs approval.

## 7. Ship

Follow the `ship` skill (`/ship`, or read `.agents/skills/ship/SKILL.md` directly): rebase
onto the default branch, full local gate, push, PR.

Two things `ship` deliberately makes you write yourself, with one default from this issue:

- **Issue link:** `Closes #<issue>` — unless this issue is an umbrella / multi-part one
  that must stay open across several PRs (a spec+plan PR from step 3 always is), in which
  case `Refs #<issue>`.
- **`## Docs`:** written fresh, never boilerplate. Answer the real question — which docs does
  this diff make stale, or why genuinely none.

After a sub-issue's PR lands, tick its checkbox in the umbrella issue — the umbrella is
the live state of the plan, and an unticked box on merged work misleads the next session.
