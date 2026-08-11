# cmux — terminal-multiplexer integration

cmux is a terminal multiplexer with named workspaces, workspace groups and a CLI
(`cmux workspace create/list/close`, `cmux notify`, `cmux identify`). This page wires the
workflow into it. Everything here is optional and per-socket — the human may take the
task workspaces and skip the review workspaces, or the reverse.

## Detect

    command -v cmux && CMUX_QUIET=1 cmux ping

BOTH checks: an installed binary whose socket is not answering is "not available", and
half the failure reports this page prevents are that exact state. Report what you found,
then ask per socket below. Detection never implies consent.

## Socket 1 — task workspaces (nothing to install)

If the worktree module is in (ADOPT.md step 2), this already works: `task:start` probes
cmux at runtime and opens a two-pane workspace (agent + shell) beside the caller's;
`task:finish` closes it last. No cmux → the scripts do the git half and say so.

The only thing to DO here is tell the human it exists. The default agent in the left
pane is `claude`; per-invocation override via `TASK_AGENT_CMD`, permanent choice by
editing `DEFAULT_AGENT_COMMAND` in `scripts/task-utils.mts` (a declared local part —
syncs keep it).

## Socket 2 — reviews in a visible workspace (the render-base switch)

The default `.agents/auto-review.sh` runs the reviewer headless in the background. With
cmux there is a better shape, and it changes WHICH template the file is rendered from:

- **Render base**: `templates/scripts/auto-review-workspace.sh` (instead of
  `templates/scripts/auto-review.sh`). Same destination, same `{{REVIEW_CMD}}` contract,
  same `auto-review` commit status on the PR.
- What it buys: the review runs on a visible terminal in a workspace called
  `review #<pr>`, placed beside the author's workspaces; the reviewer gets its own
  worktree, detached on the PR head (`<repo>-wt-review-<pr>`), reused across fix pushes;
  worktrees of closed/merged PRs are retired on the next launch (guarded by the worktree
  module's disposable predicate — worktrees with branches are never forced).
- What changes in the permission calculus: a human terminal EXISTS here, so the reviewer
  CLI may be interactive, and a machine-layer "ask" is a real question instead of a
  stall. The rest of ADOPT.md's "Reviewer CLI" step applies unchanged — allow-broad +
  deny on push/merge/close, scoped reach, explicit model, and both live probes (run the
  working probe inside a workspace this base creates, not in a bare shell).
- Pairs with the worktree module: reviewer provisioning uses `worktree:setup` (filtered
  `.env` — secrets stay out of another vendor's field of view) and retirement uses
  `worktree:teardown --disposable`. Without the module the base still works — plain
  install for provisioning, leftovers reported instead of removed — but recommend
  installing the module first; the guarded delete is the better half.
- Degradation is LOUD by design: no cmux at launch time → no review starts, the
  `auto-review` status goes red with "run /review <pr> yourself". A visible-terminal
  review has no honest silent fallback — a headless run of an interactive render would
  stall on its first "ask" with nobody to answer. If the human wants a silent fallback,
  they want the headless base and narrower "ask"-free permissions — offer that instead.

## Socket 3 — what happens when a verdict lands

The `review` skill already says: after the verdict comment lands, do what
`docs/RUNBOOK.md` prescribes. With cmux detected, that page gets two lines — the second
only where socket 2 put reviews in a workspace:

    cmux notify --title "Review #<pr>" --body "VERDICT: approve|blocker"

    # on VERDICT: approve only
    cmux browser open "<pr-url>" --focus false

The tab lands in the reviewer's OWN workspace: `--workspace` defaults to
`$CMUX_WORKSPACE_ID`, which for a reviewer session is `review #<pr>`, so an approved PR is
waiting where the human goes to look at the review. Verified on the first adopter
(2026-08-11): the focused surface did not move, `cmux browser --surface <ref> url` returned
the PR URL, and a repeat call answered `placement=reuse` rather than stacking panels. Two
commands that look equivalent are not — `open -g <url>` is the SYSTEM browser, a different
window entirely, and the general `cmux open <url>` returned `OK urls=1` while creating no
browser surface at all.

Approve only, deliberately: a blocker is work for the author, not something to park in a
tab. Both lines are best-effort and never gate the verdict — that part is the skill's rule,
not this page's.

## Socket 4 — announcing a reviewer's "ask" (only with a hook guard)

Where the chosen reviewer CLI got a hook-layer guard (ADOPT.md's second boundary — for agy
that is `integrations/antigravity.md` socket 2, which ships the guard as a template) and it
runs interactively (socket 2 here), a machine-layer "ask" waits on a human who may be
looking elsewhere. Have the hook announce it, best-effort, before answering:

    CMUX_QUIET=1 cmux notify --title "Reviewer is waiting" \
      --body "A tool call needs your approval in this workspace." >/dev/null 2>&1 || true

The notify must never change the hook's decision or exit status: no cmux, no
notification, same JSON. Skip this socket entirely for headless setups — there is nobody
to summon.

## When cmux disappears later

Nothing needs unwiring. Sockets 1 and 4 are runtime probes that degrade silently;
socket 3 is two lines the human deletes from RUNBOOK; socket 2 fails loudly per launch
(that is its contract) — if the disappearance is permanent, re-render
`.agents/auto-review.sh` from the headless base and re-run the two live probes.
