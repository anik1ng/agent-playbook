---
name: ship
description: Take a finished task branch in this repo to a pull request — rebase, full local gate, push, open the PR against the default branch. Use when asked to ship, push, or open a PR for the current branch, whichever tool you are.
---

You are shipping the current task branch: rebase onto the default branch, run the gate,
push, open the PR. Run this when the work is done and committed.

**`AGENTS.md` "Getting to master" in THIS repo is canonical** — it defines this ritual and
this file executes it. Where the two disagree, AGENTS.md wins and this file is the bug. Work
the steps in order; a red step stops the ship, it never gets skipped.

Detect the default branch rather than assuming its name:

    DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)

## 1. Refuse to ship the wrong thing

    git status -sb

- **On the default branch** → STOP. Agents never push to it (AGENTS.md "Never"). Get on a
  task branch first — the `do` skill does that.
- **Dirty tree** → STOP. Commit the work first (AGENTS.md "Workflow" says whether that needs
  approval), or say what the stray files are. A rebase over uncommitted changes is how work
  gets lost.

## 2. Rebase onto the default branch

    git fetch origin --prune
    git rebase origin/$DEFAULT

The default branch moves under open PRs; a stale base can silently reverse a recent merge in
the squash.

On conflict: resolve honestly, per the file. **A lockfile is never resolved by hand** —
resolve the manifest (`package.json` or equivalent), then re-run the package manager's
install and let it rebuild the lockfile from the conflicted state. Never resolve a conflict
by taking one side wholesale without reading what the other side changed.

## 3. Run the full local gate

Run it exactly as AGENTS.md "Getting to master" defines it — that section is the source of
truth and wins on drift. If AGENTS.md names no gate, fall back to the scripts that exist in
`package.json` (typically `type-check`, `lint`, `test`) and say in the PR body which you ran.

**Red is a stop, not a hurdle.** Fix the code. Never delete, `.skip`, weaken or mock away a
test to get green — the human doesn't read diffs, so CI green is this project's only machine
guarantee. Formatting is fixed by running the formatter, never by hand. A dead-code or lint
hit is fixed, not silenced; a genuine false positive goes into the tool's config file WITH a
comment saying why.

## 4. Push

    git push -u origin <branch>

The repo's `.githooks/pre-push` hook runs the static gate and blocks direct pushes
to the default branch locally; the server-side branch ruleset, where configured,
refuses them too. It must run: `--no-verify`, `SKIP_PUSH_GATE` and
`ALLOW_DIRECT_PUSH` are the human's overrides and are forbidden to you (AGENTS.md "Getting to
master").

## 5. Open the PR

    gh pr create --base "$DEFAULT" --title "<conventional commit title>" --body "..."

If a PR already exists for this branch, step 4's push updated it — don't open a second one.

**Title:** a conventional commit (`feat(feed): …`, `fix: …`, `chore(agents): …`). It becomes
the squash-commit title on the default branch, and the `PR hygiene` check fails a
non-conventional one.

**Body:** follow `.github/pull_request_template.md`. Two sections are the ones that matter,
and you must WRITE them, not fill them:

- **The issue link** — `Closes #N` (auto-closes the issue and cross-links this PR into its
  timeline on squash-merge; that cross-link IS the history), `Refs #N` for an umbrella issue
  that stays open across several PRs, or `No issue` only when there genuinely isn't one.
- **`## Docs`** — every doc this diff makes stale, one `* <file> — <what changed>` bullet
  each, or `Docs: none — <real reason>`. Doc drift is a bug: if the diff changes behavior
  described in `README.md`, `AGENTS.md` or any `docs/*` page, this PR updates it. Anything
  the HUMAN runs or must remember (script, page, env var, ritual) means `docs/RUNBOOK.md`
  is one of those bullets.

The `PR hygiene` check tests these two for PRESENCE; the reviewer tests them for TRUTH. So
boilerplate here doesn't pass — it just hollows out the gate and gets blocked one step later.
Stop and answer both questions for real.

Also fill, honestly:

- **How to test by hand** — the ONLY section the human reads before testing. Concrete
  click-through steps: where to go, what to click, what must happen.
- **Risk nearby** — what this could regress, and any test change declared explicitly. A
  deleted/skipped/weakened test with no justification here is a reviewer blocker.
- If the diff touches anything AGENTS.md flags as one-branch-at-a-time (a schema, a
  generated artifact): say so, spell out what applying it does to the shared environment,
  and confirm the generated artifact is committed in this same PR.
- If test-first didn't apply (docs, config, pure deletion, indexes, logging), say that
  outright instead of implying tests exist.

## 6. Hand off

Print the PR URL, and state plainly: what still needs doing (anything the human owes —
env vars, dashboard clicks, one-off SQL), and that a substantive PR gets an independent
`review` pass from a FRESH session — ideally a different model family, which is the one
hard rule in AGENTS.md "Model routing" — before the human merges. You never merge, and green
CI is not permission to merge.
