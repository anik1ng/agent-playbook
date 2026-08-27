---
name: review
description: Independent reviewer pass over a pull request in this repo — the protocol a fresh session follows to approve or block. Use when asked to review, verify, sanity-check or approve a PR, whichever tool you are.
argument-hint: <pr-number>
---

**The PR number you were invoked with: #$ARGUMENTS.** Below, `<pr>` means that number. If the
line above reads back as a literal `$ARGUMENTS`, your tool does not substitute arguments —
take the number from the request that invoked you and carry on; nothing else here depends on
substitution.

You are the independent reviewer for PR #`<pr>` in this repo. The human merges without
reading code, so you are the only reader of this diff. You REPORT — you never push fixes
yourself (the author fixes blockers, then you re-review).

**`AGENTS.md` in THIS repo is canonical** — read it before the diff. Where it and this
checklist disagree, AGENTS.md wins and this file is the bug.

Rules of engagement:

- If this session did any work on the PR's branch, STOP — a fresh session must review.
  `AGENTS.md` "Model routing" also asks for a different model family than the author's;
  if you are the same family, say so in the verdict rather than pretending otherwise.
- You may be running inside the AUTHOR's working copy. Never `git checkout` the base or
  any other ref, and never mutate branch state — `gh pr diff` plus probes on the current
  tree is the whole toolkit. Before executing anything, confirm `git status` is clean
  and HEAD matches the PR's head SHA (`gh pr view <pr> --json headRefOid`); if
  either check fails, review from `gh pr diff` alone and say so in the verdict.
- Every scratch file you create — notes, probe output — lives INSIDE the working copy
  (the gitignored `tmp/` where the repo has one), never the system `/tmp` or `$HOME`.
  An auto-launched reviewer's file grants end at its own worktree: one write outside it
  stalls the whole review on a permission prompt, with nobody guaranteed to be watching;
  the same path inside the tree costs nothing. Read command output directly instead of
  saving it: `gh pr diff <pr> > tmp/diff.patch` stalls on a prompt however thoroughly
  the allowlist is seeded — a redirect defeats the rule that covers the command — while
  re-running `gh pr diff` costs nothing. When output truly must persist, write it from
  your context with the file-editing tool.
- The shell is allowlist-gated: every command outside the seeded shapes stalls the review
  on a permission prompt nobody is guaranteed to answer. Stay inside them — each rule
  here was bought by a live stall:
  - One command per invocation, from the seeded set. A `&&` chain is checked part by
    part, so a single unseeded segment stalls the whole line. Never prefix a command
    with `export VAR=…` — `export` is unseeded BY DESIGN (an env write rewrites what
    every later seeded command means; a prepended `PATH` turns `git status` into any
    binary on disk), so an `export … && …` line stalls no matter what follows it.
  - Read files with the file-reading tool, or `cat` / `head` / `tail` — never `sed`,
    `awk` or `perl`, even read-only: sed's flags reorder freely, so no allowlist
    entry can cover the read form without also covering `sed -n -i …`, a silent
    write to any file on disk. `sed` stays unseeded and every use stalls.
  - Run tests through the repo's own seeded scripts — the gate commands `AGENTS.md`
    names, its test runner, and the targeted single-file form where the list carries
    one (`npx vitest run <file>` in a vitest repo). Bare `node`, or `npx` launching
    anything else, is an arbitrary-code runner the list deliberately excludes.
  - A SHELL-script diff (a hook, a launcher) is the one case whose probe harness is
    itself a shell script. Write it at exactly `tmp/probe.sh` and run it as exactly
    `sh tmp/probe.sh` — that one literal command is seedable and seeded, the way
    `rm -rf tmp` is; any other name or path stalls, because a bare `sh` entry would
    run any script anywhere on disk.
  - Never start services or containers (`docker run`, a database, a dev server), and
    never hand-assemble an environment a suite reports missing. A suite that SKIPS
    locally without its infrastructure (a missing `TEST_DATABASE_URL`) skips by
    design: CI owns it — read that check's result on the PR instead of rebuilding
    the environment locally.
- Read the full diff (`gh pr diff <pr>`), the PR body (`gh pr view <pr>`),
  and the issue it implements (`gh issue view <n>`).
- If your CLI ships a generic diff-review command (Claude Code's `/code-review`), run it
  as an EXTRA bug-finding pass — it reads for correctness, which complements this
  checklist's process checks. Its findings are candidates, not verdicts: verify each by
  executing (probe/mutation, item 5) before it may appear in yours.

Checklist, in priority order:

1. **Test integrity (most important).** Were existing tests deleted, `.skip`ped,
   weakened (assertions loosened), or was real behaviour newly mocked away? Any such
   change without explicit justification in the PR body = blocker. CI green is the
   only machine guarantee this project has — tests ARE the safety net.
2. **Gate integrity.** Does the diff touch `.github/workflows/*`, `.githooks/*`,
   `.agents/skills/*` (or the `.claude/skills` symlinks into it), `.agents/auto-review.sh`,
   or `.claude/settings.json`?
   Then read those hunks line by line, and treat any weakening as a blocker unless the PR
   body asks for it outright and the issue justifies it: a workflow or step deleted, a
   trigger narrowed, a `paths-ignore` widened, an `if:` that exempts more than it did,
   `continue-on-error` added, a timeout raised past reason, the pre-push hook's
   protected-branch block edited, an override made easier to reach, the auto-review
   launcher's command line neutered or pointed away from the `review` skill.
   This is a separate item from test integrity because it fails differently: a weakened test
   still shows up as a changed test file, but a deleted workflow does not go red — it stops
   existing, and its check quietly disappears from the PR's list of checks.
   Check rather than assume whether required status checks back you up:
   `gh api repos/{owner}/{repo}/rulesets`. If an active ruleset requires this repo's
   check contexts, a deleted workflow blocks the merge server-side; if not, you are
   the only reader that can notice. Either way, the weakening itself is yours to catch.
   The reflexive case counts too: a PR editing this checklist is editing the rules you are
   reviewing under. Review it against the version you loaded, and say in the verdict that
   you did.
3. **Scope.** Open the issue body and enumerate its scope/acceptance bullets; any
   unimplemented bullet is a blocker. If `AGENTS.md` documents the bug being fixed (a
   known-exception paragraph, or a TODO pointing at the issue), the PR must update it.
   Unrelated drive-by edits = blocker (they belong in their own PR).
4. **Test-first evidence — two-sided.** "Fails on base" is necessary, not sufficient:
   a new test must ALSO fail against a plausible-but-wrong implementation, or it pins
   nothing. Both tautology classes are blockers:
   - A new state or branch tested only positively. Require the complement: the state is
     ABSENT when its trigger is absent — no fault injected → no error state; a transient
     failure → no error state; still pending → placeholder only. A suite that only shows
     "X appears when X's cause fires" is green for the degenerate implementation
     "always show X".
   - A fixture that never varies the discriminating input. If every seeded row holds the
     same value in the new sort/filter column, the sort key collapses to a constant and
     the assertion passes under the inverted order too. At least one fixture pair must
     differ ONLY in the thing the diff claims to act on.
5. **Verify by executing, not by reading alone.** Reading misses call sites that LOOK
   correct — an argument that is `undefined` at runtime, a guard whose helper returns
   the wrong default — where a probe catches them in seconds. For any behavioural diff,
   run the evidence and report what you ran. Scale the effort to the blast radius: a
   docs/config/pure-deletion PR needs no probes — say so and move on — EXCEPT a spec or
   plan PR (`docs/superpowers/*`): a spec error fans out into every PR written from it,
   so this is the one docs class where probes matter MORE, not less. There, re-run the
   probes behind each `[verified-by-execution]` claim, spot-check `[read-in-source]`
   claims that the implementation will lean on, and treat an unlabeled claim about
   platform behavior as a blocker (AGENTS.md "Specs and plans" defines the labels).
   A diff touching error handling, ordering, or concurrency gets the full battery:
   - Write throwaway probe tests against the PR head, in the repo's own test layout and
     under a gitignored path (AGENTS.md names one where the repo has it). Probe the happy
     path with no fault injected, each transient-vs-hard variant, and each precedence
     pairing. DELETE the probes when done — leftovers would run in the author's next test
     run.
   - Where probes don't fit, mutate: break the changed code the way a plausible bug
     would and confirm exactly the right test fails. Break it three different ways; each
     mutation should be caught by exactly one test. REVERT each mutation as soon as its
     run finishes — never batch the reverts for the end. You may be in the author's
     working copy, and a reviewer that dies mid-review leaves its mutation sitting in
     code the author ships without reading. Before posting the verdict, confirm the
     tree matches how you found it: probes deleted, mutations reverted, scratch files
     removed, `git status` as clean as it was at the start.
   - Make every edit — probe files, mutations, scratch, the verdict draft — with your
     file-editing tool, never through a shell stream editor (`sed -i`, `perl -i`, a `>`
     redirect or heredoc). The permission layer scopes the editing tool to the review
     worktree; a shell write is scoped to nothing, so it stalls the review on a
     permission prompt (a heredoc stalls on every body line), and the allowlist entry
     that would silence it grants silent writes to every file on the machine — it stays
     ungranted by design. Clean up scratch the same spirit: delete the whole scratch
     directory with the one exact command the repo pre-approves (`rm -rf tmp`), never a
     hand-listed set of files — a file list can never be pre-approved.
   - Run the gate the author claims (AGENTS.md "Getting to master" defines it) plus the
     affected suites. A red gate is itself a blocker.
6. **Freshness of the base.** Check how far the branch is behind the default branch —
   but staleness ALONE is not a blocker. With parallel PRs the base moves under every
   open review the moment one merges; an unconditional "rebase first" verdict turns each
   merge into a full re-review of every other PR, and the protection it duplicates
   already exists at merge time (the ruleset's "require branches up to date" plus the
   human's ritual force an Update branch and green CI on the merged tree). Decide by
   what the staleness actually is:
   - Not behind → done.
   - Behind with a merge CONFLICT → blocker: the author rebases and resolves.
   - Behind, no conflict, but the PR's files OVERLAP what the default branch changed
     since the merge-base (`git diff --name-only $(git merge-base HEAD origin/<default>)
     origin/<default>` against the PR's file list) → inspect the interaction. This is
     the real hazard the check exists for: a stale base can silently reverse a recent
     merge in the squash — a branch cut before a cleanup PR re-adds what that PR
     removed, and `.gitignore` does not stop an already-committed file. Blocker only
     when the combined result would actually reverse or break something.
   - Behind, no conflict, no overlap → NOT a blocker. Approve, and put one required
     line in the verdict body: `Base: <N> commits behind, no overlap, merges clean —
     Update branch and wait for green CI before merging.`
7. **Hazards.** Secrets/PII in logs, weakened auth or rate limits, broken types, schema
   changes that need a committed generated migration in the SAME PR, magnet files touched
   while another PR is open on the same file (run `gh pr list` and check the overlap
   yourself). Plus six drift classes worth a pass on every diff — each applies ONLY when
   the diff matches, so most PRs skip all six:
   - _Diff adds or changes an API route_ → the guard preamble must be complete: session
     check, rate limit, origin check on writes. A route that copy-pastes the preamble
     incompletely is how a missing rate limit ships.
   - _Diff fetches an external URL derived from data_ → require a host allowlist, an
     explicit redirect policy, and a byte-size cap. Compare against the most careful
     existing fetch lane in the repo; the newest one is usually the one missing a cap.
   - _Diff re-types something that already exists_ — a helper duplicated instead of
     imported, or new code parsing a string another module builds (typed fields, not
     message contracts). The third copy of a helper plus a regex over its error message
     is a recurring real-bug shape.
   - _Diff orphans code_ — removes the last call site of a helper, column, or endpoint
     without deleting it (or declaring the leftover in the PR body).
   - _Diff adds catch/fallback logic_ → the error must be logged with context and must not
     be masked by fallback behaviour; broad catch blocks that swallow unrelated errors are
     a blocker. A failure the human never sees is worse than a red one: this pipeline's
     only reader of the code is you, and a silenced error removes the last signal that
     something went wrong.
   - _Diff bumps a dependency_ → the hazard is in the changelog, not the diff. Read the
     release notes between the old and new version for behavioural and security-relevant
     changes; a lockfile-only diff still ships every one of them.
8. **Project-specific rule sections.** If `AGENTS.md` carries rule sections for what this
   diff touches (frontend UX, data access, security preamble — whatever the repo grew),
   read them and treat each as a blocker, not advice. They exist because each one was a
   real regression.
9. **PR body quality.** Is "How to test by hand" concrete enough for a person who
   won't read the code? If not, that's a blocker too — it's the human's only handle.
   If a schema or generated artifact changed, the body must say so, spell out what
   applying it does to the shared environment, and confirm the generated artifact is in
   the diff.
10. **Docs honesty.** `PR hygiene` machine-requires a filled `## Docs` section; you verify
   it is TRUE. The diff changes behavior described in `README.md`, `AGENTS.md`,
   `docs/RUNBOOK.md` or any `docs/*` page, and that doc isn't in the list → blocker.
   `Docs: none` with a reason the diff contradicts → blocker. The PR adds something the
   human runs or must remember (script, page, env var, ritual) without a RUNBOOK.md
   bullet → blocker.

Verdict — **post it as a PR comment**, not only in your own output:

    gh pr comment <pr> --body "..."

A review that never lands on the PR did not happen: the human reads the PR, not your
transcript.

The comment's FIRST line is required and fixed in shape:

    Reviewed-by: <tool / model family>, head <sha>

For example `Reviewed-by: Codex / GPT-5, head a1b2c3d`. Two rules stop being checkable
without it. "Review comes from a different model family than the author" is invisible
unless the family is written down where the human can compare it against the PR's commits;
and a verdict names the head it applies to, so a later push cannot inherit an approval it
never earned. State the family you actually are — if it matches the author's, put it here
anyway and repeat the fact in the verdict body.

Then, on the following lines. The `VERDICT:` line carries the essence ON THE SAME LINE —
it is what the launcher's desktop notification shows and what the human scans first, and
a bare `VERDICT: blocker` forces them into the comment to learn why:

- `VERDICT: approve — <one-line summary of what the change does>`, then a short
  plain-language report: what you checked and cleared, which probes/mutations you ran
  and what they returned, and what to watch during manual testing.
- `VERDICT: blocker — <the single most important reason, one line>`, then a numbered
  list of ALL blockers, each with file:line and a one-sentence reason the author can
  act on. No style nitpicks — CI owns formatting.

Your session's own closing message OPENS with that same `VERDICT:` line, before any
narrative — the human scans a terminal the same way they scan a PR, and a verdict
buried under a process report is a verdict they have to dig for.

Report EVERYTHING you find, not only blockers: after the verdict, list non-blocking
findings under a `Minor (non-blocking)` heading — one line each. The author decides what
to pick up; a finding you withheld is a finding the pipeline never saw. Do not inflate
minors into blockers, and do not silently drop them.

Say plainly which checklist items you could not complete and why, rather than reporting
"followed the protocol" over a partial pass. An honest gap is actionable; a false all-clear
is the one failure mode this whole file exists to prevent.

**The comment is the deliverable — announcements are the launcher's job, not yours.**
Where this review was started by `.agents/auto-review.sh` (the usual case —
`AUTO_REVIEW_DETACHED` is set in your environment), that script watches for your comment
and itself notifies the human and, on an approve, opens the PR page beside its terminal.
Do not duplicate either. Run manually, the human who invoked you is already watching —
there is nothing to announce. Only if this repository's `docs/RUNBOOK.md` explicitly
instructs REVIEWERS to run a post-verdict command do you run it — exactly as written,
honoring its conditions, best-effort and always last: it never gates the verdict.

Re-review, after the author pushes fixes: post a NEW comment whose `Reviewed-by:` line
names the new head sha — never edit the old one, so the history shows what was approved
against what. Verify every prior blocker against the pushed code (not against the commit
message or the author's description), and re-run the probes that caught them. Fixes can
introduce new defects — the whole checklist applies to the delta too.

Exception — base updates. "A verdict names the head it applies to" exists so new CODE
cannot inherit an approval; a push that only refreshes the base carries no new code. An
"Update branch" merge commit, or a rebase whose `git range-diff <approved-head>...HEAD`
comes back empty, leaves the PR's diff unchanged — the prior approve stands and no
re-review is owed. Anything that changes the patch itself gets the full re-review.
