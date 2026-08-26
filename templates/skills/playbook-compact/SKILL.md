---
name: playbook-compact
description: Mercilessly compact this repository's accumulated agent memory — CLAUDE.md, AGENTS.md, docs/RUNBOOK.md and the docs/superpowers archive — without losing a single live rule. Use when asked to compact, clean, slim or prune the project docs, whichever tool you are.
---

You are compacting this repository's accumulated memory. The auto-loaded files
(`CLAUDE.md`, `AGENTS.md` and whatever they `@`-include) are paid for by EVERY session
before it reads a line of code, and lean context measurably improves the agent —
Anthropic cut ~80% of Claude Code's own system prompt for the Claude 5 generation with
no measured eval loss. These files grow by design (a rule per incident) and nothing ever
removes; this skill is the forgetting. The measure of success is **nothing lost**, not a
line count hit — there are deliberately NO numeric targets: a five-file repo and an
archive browser do not share a number, and a hard cap makes an agent cut arbitrarily to
fit.

**Own branch, own PR — never mixed with a playbook sync.** A sync changes mechanism;
this changes the project's memory. Ship by this repo's own rules; the normal independent
review applies, and the reviewer's question is "which live rule was lost?". The PR body
must answer it explicitly: `Live rules lost: none` — or list each loss with the human's
recorded yes. Everything deleted stays in git history; that, plus the review, is what
makes merciless safe.

## The knife — derivability

For every paragraph ask: **could a fresh session derive this from the repository
alone?** Yes → delete. No → keep, compressed to its facts. Three classes are
non-derivable and stay:

- **Facts that live outside the repo** — server topology, hosting-panel configuration,
  the env-var inventory, external services. No session can read the human's VPS.
- **Knowledge bought by an incident** — the trap that cost a real bug. The lesson stays
  (one or two sentences); the story of discovering it goes.
- **Time-critical recovery paths** — the recipes needed the day production is down,
  when re-deriving costs the hour nobody has.

Prose that restates what a script or the code already says is the named example of
derivable: delete it and let the reader read the script.

**Touch only what you change.** Never re-wrap or re-flow a paragraph you are not
otherwise editing: this PR invites its reviewer to interrogate every removed line, and a
diff inflated by cosmetic re-wrapping buries the real deletions it exists to show — on
the first live run of this skill, a large share of the diff was width-only re-wrapping.

## Per file

- **`CLAUDE.md` / `AGENTS.md` (auto-loaded — the expensive ones).** Rules stay,
  reasoning goes. A decision record shrinks to verdict + unblock condition (+ date and
  issue ref); a superseded record shrinks to one line saying what superseded it.
  Narrative history ("Current State" storytelling, how-it-came-to-be) becomes
  present-tense facts: what IS, not how it got here. A paragraph another loaded file
  already carries becomes a pointer.
- **`docs/RUNBOOK.md`.** Recipes only, and only non-derivable ones (the knife above).
- **`docs/superpowers/specs/` — KEEP.** They are the repo's decision record (its ADRs)
  and cost no context (read on demand). The real hazard is a STALE spec read as truth:
  where later work replaced a spec's design, add a superseded banner at its top naming
  what replaced it — never delete.
- **`docs/superpowers/plans/` and `brainstorm-briefs/` — delete the spent ones.** A
  plan is construction scaffolding; once its umbrella issue is CLOSED it is spent.
  Verify closure with `gh issue view`, never guess; plans of open umbrellas stay.

## Protected — the human's explicit yes, item by item

Never compacted, moved or deleted on your own authority:

- Live rules — anything that changes how a session behaves today.
- The verdict and unblock condition of any decision record.
- Verified data-mapping references (e.g. field maps checked against a live system):
  re-deriving one costs live-system verification, not a file read.

## Procedure

1. **Measure**: `wc -w` per target file; note the totals.
2. **Report BEFORE writing** — per file: current size, what class of content goes
   (derivable prose / superseded records / narrative), what stays, and every protected
   item you propose to touch (each needs its own yes). Writing first makes the review
   theatre.
3. On the human's yes: apply, then re-measure the FINAL tree — the same `wc -w` as
   step 1, run after your last edit, so the numbers land in the same commit as the text
   they measure (the first live run recorded mid-flight counts 2–3% off the merged
   files) — and record the new baselines in `.agents/playbook.lock` as
   `docs <file> <words>`
   lines (create the file with only a header and `docs` lines if it does not exist
   yet — `/playbook-update` fills the `commit` line at the next sync).
   `/playbook-update` reads these to report growth.
4. One PR, before/after word counts in the body, `Live rules lost:` answered.
