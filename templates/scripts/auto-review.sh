#!/bin/sh
# The template for `.agents/auto-review.sh`. Launched by the `ship` skill
# right after a PR is opened or updated: one fresh session of this repo's
# chosen reviewer CLI follows `.agents/skills/review/SKILL.md` and posts its
# verdict as a comment on the PR.
#
# The review runs on a VISIBLE terminal in a cmux workspace named
# `review #<pr>`, beside the author's workspaces, in ONE reviewer worktree
# per repository (`<repo>-wt-review`) — detached, and reset to the PR head
# at the moment the review actually starts.
#
# One worktree and not one per PR, because a reviewer CLI trusts
# DIRECTORIES: a per-PR path asked the human "do you trust this folder?" on
# every single PR, forever, which is the exact opposite of an unattended
# review (seejs.app, six PRs in a row). The price is that reviews SERIALISE
# — a second PR's review waits on a lock and says "queued behind #N" in its
# `auto-review` status until the running one finishes. Waiting, not
# superseding: both verdicts are wanted, and a reviewer whose tree is reset
# mid-read files a verdict about a diff that no longer exists. Preemption
# still applies WITHIN one PR (a fix push replaces that PR's own review).
#
# Visible on purpose: where the reviewer CLI's machine layer
# answers "ask" for a tool, the human on this terminal is who answers.
# No cmux at launch → no review starts and the `auto-review` status goes
# red saying to run /review by hand. There is deliberately no silent
# headless fallback — a session built to ask questions must not run where
# nobody can answer them.
#
# The REVIEW_CMD line at the bottom is this repo's ONE local part (the
# playbook's UPDATE.md keeps it across syncs): the reviewer CLI's command
# line, rendered at adoption from the CLI's own --help. Its contract:
# it passes "$REVIEW_PROMPT" (exported below — the script owns the prompt,
# the line owns only the CLI, model and flags), interactive is allowed
# (real terminal), scoped to the reviewer's worktree, no blanket permission
# bypass, push/merge/close machine-denied, the model named explicitly
# (cross-family vs the authoring tool).
#
# The human watches the PR page, not this terminal: an `auto-review` commit
# status tracks the run — pending at launch, green when the verdict comment
# lands, red when the review ends without one. A DETACHED watcher owns that
# status (see POLL below): an interactive session outlives its own review, and
# it can end in two ways nothing inside it is able to report — sitting on an
# unanswered prompt, and being killed together with its workspace. Past an
# hour the status starts saying how long it has been waiting instead of going
# quiet; past twelve it calls the review abandoned. The verdict is ALWAYS the
# comment — a green status is not an approval.
#
# When the verdict lands, THIS script announces it — a desktop notification,
# and on an approve the PR page as a background tab beside the reviewer's
# terminal. Here and not in the review skill or docs/RUNBOOK.md, on purpose:
# this is the one synced file that is already cmux-specific, so the behavior
# arrives working in every adopted repo with nothing to configure. A synced
# feature must never depend on a file the sync is forbidden to touch.

PR="$1"
case "$PR" in
  ''|*[!0-9]*) echo "usage: auto-review.sh <pr-number>" >&2; exit 2 ;;
esac

# --git-common-dir, not --git-dir: the two halves of this script run in
# DIFFERENT worktrees (the author's and the reviewer's), and `--git-dir` in a
# worktree points at `.git/worktrees/<name>`. Only the common dir gives both
# halves the same log, pidfile and workspace record.
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null) || {
  echo "auto-review: not inside a git repository" >&2
  exit 1
}
GIT_COMMON=$(cd "$GIT_COMMON" && pwd)
PIDFILE="$GIT_COMMON/auto-review-$PR.pid"
LOG="$GIT_COMMON/auto-review-$PR.log"

# Visibility is best-effort by design: if gh or the network is down, the
# review still runs and the log still fills — only the PR-page signal is lost.
#
# The poll mode below INHERITS its head instead of reading it: it watches the
# head that was actually reviewed, and the PR's head may have moved on since
# (a fix push during a long review). Re-reading here would point the watcher's
# status at a commit its reviewer never saw.
if [ -n "$AUTO_REVIEW_POLL_HEAD" ]; then
  HEAD_SHA="$AUTO_REVIEW_POLL_HEAD"
else
  HEAD_SHA=$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)
fi

set_status() { # $1 = pending|success|failure, $2 = description
  [ -n "$HEAD_SHA" ] || return 0
  gh api "repos/{owner}/{repo}/statuses/$HEAD_SHA" \
    -f state="$1" -f context=auto-review -f description="$2" \
    >/dev/null 2>&1 || true
}

cmux_q() { CMUX_QUIET=1 cmux "$@" 2>/dev/null; }

# The twin of cmux_q for the calls whose FAILURE has to leave a trace.
#
# cmux_q's `2>/dev/null` is right for the JSON readers above — cmux's own noise
# is uninteresting when a parser is the reader — and wrong everywhere the call
# site writes to the log, because that redirection is applied to the FUNCTION
# CALL: the `2>/dev/null` inside then re-points fd 2 for the cmux process
# itself, so `cmux_q … >>"$LOG" 2>&1` logs stdout and drops the error. Together
# with a trailing `|| true` that made a 100%-reproducible reorder failure
# invisible in every channel there is — the log, the `auto-review` status and
# the PR page (seejs.app #52; the only artifact was a workspace in the wrong
# place, which reads as a workflow violation rather than a bug). Best effort may
# still mean "not fatal"; it must never mean "silent".
cmux_log() { CMUX_QUIET=1 cmux "$@" >>"$LOG" 2>&1; }

# The workspace ref inside a cmux acknowledgement line, or nothing.
#
# Every cmux command acknowledges on stdout with `OK <something>` — `workspace
# create` answers `OK workspace:22`, a dry-run reorder answers `OK plan
# workspace=… window=… index=…` — and CMUX_QUIET=1 does NOT strip that: it
# silences the deprecation notices, nothing else. So `$(cmux_q workspace
# create …)` is the whole line, and handing it back as a handle is refused —
# `Invalid workspace handle: OK workspace:22 (expected UUID, ref like
# workspace:1, or index)` [verified-by-execution, cmux 0.64.22, 2026-08-14].
# Match the ref rather than trimming a known prefix: `OK ` is one ack shape
# among several, and the ref is the part that has a syntax.
cmux_ref() { sed -n 's/.*\(workspace:[0-9][0-9]*\).*/\1/p' | head -1; }

# The workspace called $1, or nothing. Ambiguity answers nothing on purpose:
# cmux does NOT refuse a duplicate name, and closing the wrong session is
# worse than leaving both open.
#
# Ambiguity (`m.length !== 1`) is the SILENT case, deliberately. A throw is not:
# unparseable output from cmux is indistinguishable from "no such workspace" at
# the call site, and the caller acts on that answer — it would skip closing a
# superseded review and let two reviewers file verdicts against different heads.
# So the catch says so, on stderr routed to the log, and still answers nothing.
workspace_ref() {
  cmux_q workspace list --json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const m = JSON.parse(s).workspaces.filter((w) => w.title === process.argv[1]);
        if (m.length === 1) process.stdout.write(m[0].ref);
      } catch (e) {
        process.stderr.write("workspace_ref(" + process.argv[1] + "): could not read the cmux workspace list — " + e.message + "\n");
      }
    });
  ' "$1" 2>>"$LOG"
}

# The workspace whose cwd is (or is inside) the directory in $1, or nothing.
#
# This is the STABLE key, where title is not: a title is a human-facing field
# that gets renamed by definition — the blocker for seejs.app #53 was lost to
# an author workspace renamed "do #9 loop guard", which a title match for "9"
# answered nothing about, silently. The cwd is how cmux itself says where a
# workspace lives (`workspace list --json` calls it current_directory; the
# workspace.closed event calls the same value cwd). Both sides are realpath'd
# before comparing — worktree paths reach this script from git and from cmux,
# and a symlinked parent would otherwise be a false miss. Ambiguity answers
# nothing, same rule and same reason as workspace_ref above.
workspace_ref_by_dir() {
  cmux_q workspace list --json | node -e '
    const fs = require("fs");
    const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
    const target = real(process.argv[1]);
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      if (target === null) return;
      try {
        const m = JSON.parse(s).workspaces.filter((w) => {
          if (typeof w.current_directory !== "string" || w.current_directory === "") return false;
          const dir = real(w.current_directory);
          return dir !== null && (dir === target || dir.startsWith(target + "/"));
        });
        if (m.length === 1) process.stdout.write(m[0].ref);
      } catch (e) {
        process.stderr.write("workspace_ref_by_dir(" + process.argv[1] + "): could not read the cmux workspace list — " + e.message + "\n");
      }
    });
  ' "$1" 2>>"$LOG"
}

# The CALLER's own workspace ref, or nothing when this run is not inside a
# cmux workspace. Feeds two placements below: which group the reviewer joins,
# and which workspace it is parked next to. A THROW is reported, for the same
# reason as in workspace_ref: silence here downgrades placement without saying
# why, and the reviewer lands at the bottom of the sidebar looking like a bug
# in cmux.
caller_workspace_ref() {
  cmux_q identify | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { process.stdout.write(JSON.parse(s).caller.workspace_ref ?? ""); } catch (e) {
        process.stderr.write("caller_workspace_ref: could not read cmux identify — " + e.message + "\n");
      }
    });
  ' 2>>"$LOG"
}

# The workspace group the ref in $1 sits in, or nothing.
#
# Without this the reviewer lands outside the author's group, at the bottom of
# the sidebar, which is exactly where you do not look for it. cmux reports
# membership only from the group side (`workspace-group list`), never on the
# workspace, so the caller's own ref has to be matched against the members.
# An ungrouped caller answers nothing — the expected path, and it stays quiet.
caller_group_ref() {
  [ -n "$1" ] || return 0
  cmux_q workspace-group list --json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const g = JSON.parse(s).groups.find((g) =>
          (g.member_workspace_refs ?? []).includes(process.argv[1]));
        if (g) process.stdout.write(g.ref);
      } catch (e) {
        process.stderr.write("caller_group_ref: could not read the cmux workspace-group list — " + e.message + "\n");
      }
    });
  ' "$1" 2>>"$LOG"
}

WORKSPACE="review #$PR"

# The author's LIVE task workspace for this PR, or nothing. Resolved at SEND
# time, never remembered at launch: cmux renumbers workspace refs across app
# restarts (probed 2026-08-13, cmux 0.64), so a ref recorded when the review
# started can name somebody else's workspace by the time the verdict lands.
# The chain: the PR's branch names the worktree (`git worktree list` says
# which), and the worktree's PATH names the workspace — by cwd first
# (workspace_ref_by_dir, the stable key), by the `<repo>-wt-<name>` title
# convention second, kept as the fallback it should always have been. Title
# was the PRIMARY once, and it cost a real blocker: the convention "title
# equals <name>" does not survive contact with a rename, and every live
# workspace on the machine that day violated it — one of them renamed by
# THIS script (`review #<pr>` below).
#
# The outcome is LOGGED unconditionally, resolved or not. Every consumer of
# this function is best-effort (`|| true` all the way down), which is right —
# a missing cmux must never gate a verdict — but best effort that leaves no
# trace made this exact miss indistinguishable from the feature not
# existing, for a whole debugging session (seejs.app #53).
author_workspace_ref() {
  AUTHOR_BRANCH=$(gh pr view "$PR" --json headRefName --jq .headRefName 2>/dev/null)
  [ -n "$AUTHOR_BRANCH" ] || {
    echo "author workspace: unresolved — could not read the PR head branch" >>"$LOG"
    return 0
  }
  AUTHOR_WT=$(git worktree list --porcelain | awk -v b="branch refs/heads/$AUTHOR_BRANCH" '
    /^worktree / { path = substr($0, 10) }
    $0 == b { print path; exit }')
  [ -n "$AUTHOR_WT" ] || {
    echo "author workspace: unresolved — no worktree holds $AUTHOR_BRANCH" >>"$LOG"
    return 0
  }
  AUTHOR_WS=$(workspace_ref_by_dir "$AUTHOR_WT")
  if [ -z "$AUTHOR_WS" ]; then
    case "$AUTHOR_WT" in
      *-wt-*) AUTHOR_WS=$(workspace_ref "${AUTHOR_WT##*-wt-}") ;;
    esac
  fi
  if [ -n "$AUTHOR_WS" ]; then
    echo "author workspace: $AUTHOR_WS (worktree $AUTHOR_WT)" >>"$LOG"
    printf '%s' "$AUTHOR_WS"
  else
    echo "author workspace: unresolved for $AUTHOR_WT — no workspace matches by cwd or title" >>"$LOG"
  fi
}

# Has a verdict naming this head been posted? Defined up here because it is
# the one question all three status writers ask — the watcher, the exit path,
# and the watcher's own retirement check.
verdict_posted() {
  [ -n "$HEAD_SHA" ] || return 1
  SHORT=$(printf '%.7s' "$HEAD_SHA")
  gh pr view "$PR" --json comments --jq '.comments[].body' 2>/dev/null \
    | grep -q "head $SHORT"
}

# Tell the human, once per head: a desktop notification with the verdict, and
# — approve only — the PR page as a background tab in the reviewer's own
# workspace (a blocker is the author's work, not something to park in a tab).
# Best-effort at every step: no cmux → no announcement, and nothing here ever
# gates the status or the verdict. The stamp file keeps the poller and the
# exit path from announcing the same verdict twice.
announce_verdict() {
  [ -n "$HEAD_SHA" ] || return 0
  command -v cmux >/dev/null 2>&1 || return 0
  SHORT=$(printf '%.7s' "$HEAD_SHA")
  STAMP="$GIT_COMMON/auto-review-$PR.announced-$SHORT"
  [ -f "$STAMP" ] && return 0
  : >"$STAMP"
  # The FULL verdict line of the comment whose Reviewed-by names this head —
  # `VERDICT: blocker — <reason>` per the review skill. The reason rides into
  # the notification so the human reads the outcome without opening the PR;
  # truncated because notification bodies are one line, not a report.
  VERDICT=$(gh pr view "$PR" --json comments --jq '.comments[].body' 2>/dev/null \
    | awk -v s="head $SHORT" 'index($0, s) {f=1} f && /VERDICT:/ {print; exit}' \
    | cut -c1-160)
  CMUX_QUIET=1 cmux notify --title "Review #$PR" \
    --body "${VERDICT:-verdict posted} (head $SHORT)" >/dev/null 2>&1 || true
  case "$VERDICT" in
    *[Aa]pprove*)
      URL=$(gh pr view "$PR" --json url --jq .url 2>/dev/null)
      if [ -n "$URL" ]; then
        CMUX_QUIET=1 cmux browser open "$URL" --focus false >/dev/null 2>&1 || true
      fi
      ;;
    *[Bb]lock*)
      # Three channels, durable ones FIRST — the sidebar lane and the
      # checklist item survive an author session that is closed or restarted;
      # the send only reaches a live one, and starts the fix loop when it
      # does: the session receives the verdict as an ordinary user message
      # and goes to work before the human has even read it (`cmux send` into
      # a live interactive session is probed behavior, 2026-08-13 — the text
      # queues cleanly even mid-task). Approve sends nothing — what follows
      # an approve (hand-test, merge) is the human's, not an agent's. Every
      # step stays best-effort, but through cmux_log, never silently: a
      # delivery that fails must at least say so somewhere (this exact path
      # once failed 100% silently — see author_workspace_ref above). The
      # status description carries the outcome too, because the PR page is
      # the one artifact the human is already looking at.
      AUTHOR_WS=$(author_workspace_ref)
      if [ -n "$AUTHOR_WS" ]; then
        cmux_log workspace status set needs-attention --workspace "$AUTHOR_WS" || true
        cmux_log todo add --workspace "$AUTHOR_WS" --origin agent \
          "PR #$PR: fix review blockers, then /ship to re-review" || true
        cmux_log send --workspace "$AUTHOR_WS" -- \
          "auto-review of PR #$PR: BLOCKER — read the reviewer's verdict comment on the PR, fix the blockers, then /ship to re-review.\n" || true
        set_status success "blocker for $SHORT — delivered to the author's workspace ($AUTHOR_WS)"
      else
        set_status success "blocker for $SHORT — author workspace UNRESOLVED, relay it yourself (see the log)"
      fi
      ;;
  esac
}

# The paths both halves need. `git worktree list` reports the MAIN checkout
# first from anywhere inside the repository — including from the reviewer's
# own worktree, which is where the inner half runs.
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
REPO_NAME=$(basename "$MAIN")
WORKTREE="$(dirname "$MAIN")/$REPO_NAME-wt-review"

# The package manager, from the main checkout's lockfile — detected at
# runtime so this file needs no rendering beyond REVIEW_CMD.
if [ -f "$MAIN/pnpm-lock.yaml" ]; then PKG=pnpm; INSTALL="pnpm install --frozen-lockfile"
elif [ -f "$MAIN/yarn.lock" ]; then PKG=yarn; INSTALL="yarn install --immutable"
elif [ -f "$MAIN/bun.lock" ] || [ -f "$MAIN/bun.lockb" ]; then PKG=bun; INSTALL="bun install --frozen-lockfile"
elif [ -f "$MAIN/package-lock.json" ]; then PKG=npm; INSTALL="npm ci"
else PKG=npm; INSTALL="npm install"
fi

# ===========================================================================
# POLL: own the `auto-review` status on behalf of a review that is running.
#
# A separate process, and a DETACHED one, because both ways a review can end
# without a verdict are invisible from inside it:
#
#   - the reviewer SITS THERE. An interactive CLI is interactive by design; a
#     session parked on an unanswered permission prompt is indistinguishable,
#     from the outside, from one reading a large diff. The inner half is
#     blocked on the CLI for as long as that lasts and cannot say a word.
#   - the WORKSPACE IS CLOSED. cmux kills the whole process tree without
#     running traps (probed 2026-08-19: a TERM handler in the workspace's
#     command never fires, and a plain `&` background child dies with it), so
#     nothing inside that tree gets a last word either. The queue above
#     already depends on this — it is why a lock can outlive its holder.
#
# Both used to end the same way: `pending`, forever. nsarchive#134 sat there
# for seventeen hours, which turns the one status a human reads as "still
# working, wait" into "at some point in the last N hours this may have stopped
# mattering". So the watcher lives OUTSIDE the tree it watches — setsid, hence
# perl, because macOS ships no setsid(1) — and outlives everything in it.
#
# It never releases the review's lock, which is why this block sits ABOVE the
# halves: a poll run is a fresh process that exits here, long before the inner
# half is anywhere near setting that trap.
# ===========================================================================

if [ -n "$AUTO_REVIEW_POLL" ]; then
  REVIEWER_PID="$AUTO_REVIEW_POLL"
  SHORT=$(printf '%.7s' "$HEAD_SHA")
  echo "watcher $$ following reviewer $REVIEWER_PID (head $SHORT)" >>"$LOG"

  waited=0
  interval=60
  restated=0
  while :; do
    sleep "$interval"
    waited=$((waited + interval))

    # Retired? The pidfile names the review this watcher belongs to: a newer
    # review of the same PR overwrites it, and the supersede path removes it
    # before closing the old workspace. Either way this watcher now follows a
    # review nobody wants a status for, and must write NOTHING — the review
    # that replaced it has already set its own. Checked before the verdict on
    # purpose: a stale success is as wrong as a stale failure.
    [ "$(cat "$PIDFILE" 2>/dev/null)" = "$REVIEWER_PID" ] || {
      echo "watcher $$ retired — the review of #$PR is no longer $REVIEWER_PID's" >>"$LOG"
      exit 0
    }

    # The verdict before the session, always: one that posts and immediately
    # dies still delivered, and this order is what keeps that green.
    if verdict_posted; then
      set_status success "verdict posted for $SHORT — read it before merging"
      announce_verdict
      exit 0
    fi

    if ! kill -0 "$REVIEWER_PID" 2>/dev/null; then
      echo "watcher $$: reviewer $REVIEWER_PID is gone, no verdict for $SHORT" >>"$LOG"
      set_status failure "reviewer session ended without a verdict for $SHORT — run /review $PR yourself"
      exit 0
    fi

    # Half a day without a verdict is not a slow review, it is an abandoned
    # one. A watcher that outlives its workspace also has to stop by itself:
    # `kill -0` against a recycled pid answers "alive" forever.
    if [ "$waited" -ge 43200 ]; then
      echo "watcher $$: giving up on $SHORT after 12h" >>"$LOG"
      set_status failure "no verdict for $SHORT after 12h — the review was abandoned; run /review $PR yourself"
      exit 0
    fi

    # Past the first hour, say the age out loud rather than leaving `pending`
    # to be read as "nearly done". Still PENDING, because it still might be:
    # from out here, thinking and waiting-on-a-prompt look identical, and the
    # description says exactly that instead of guessing — calling it red would
    # send the human to run a second review against a lock the first one holds.
    # Restated on a cadence that always changes the text, for the same reason
    # the queue announces once per holder: a status write that says nothing new
    # is API traffic. The poll slows to match — a verdict that has not appeared
    # in an hour will not appear in the next sixty seconds.
    [ "$waited" -ge 3600 ] || continue
    interval=300
    if [ "$waited" -lt 10800 ]; then age="$((waited / 60)) min"; step=1800
    else age="$((waited / 3600))h"; step=3600
    fi
    if [ "$((waited - restated))" -ge "$step" ]; then
      restated=$waited
      echo "watcher $$: no verdict for $SHORT after $age" >>"$LOG"
      set_status pending "no verdict after $age — the reviewer may be waiting on a prompt; check the “${WORKSPACE}” workspace"
    fi
  done
fi

# ===========================================================================
# OUTER: make sure the reviewer's checkout EXISTS, hand the review to a
# workspace. It deliberately does not reset or provision that checkout — a
# review may be running in it right now, and this one may be queued behind
# it. Both belong to the inner half, behind the lock.
#
# Detach here, not in the caller: the ship skill invokes this script plainly,
# so the launch mechanics are THIS file's business — a machine that runs its
# reviewer differently re-renders only this script, never the vendor-neutral
# skill.
# ===========================================================================

if [ -z "$AUTO_REVIEW_DETACHED" ]; then
  {
    echo "=== auto-review PR #$PR (head ${HEAD_SHA:-unknown}) launching: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
  } >>"$LOG"

  # Announce stamps are per-head; a new launch means the old heads' stamps
  # are history.
  rm -f "$GIT_COMMON/auto-review-$PR.announced-"*

  if ! command -v cmux >/dev/null 2>&1 || ! cmux_q ping >/dev/null 2>&1; then
    # No silent fallback to a background run: this script exists because a
    # human terminal answers the prompts; without one, a sandboxed reviewer
    # gets tools denied and files a hollow verdict. Failing loudly is the
    # honest outcome.
    echo "cmux unavailable — no review started." >>"$LOG"
    set_status failure "cmux unavailable — no reviewer started; run /review $PR yourself"
    echo "auto-review: cmux unavailable — no review started (see $LOG)" >&2
    exit 1
  fi

  if [ -z "$HEAD_SHA" ]; then
    echo "could not read the PR head from gh — no review started." >>"$LOG"
    echo "auto-review: gh could not name PR #$PR's head; no review started" >&2
    exit 1
  fi

  # Say something on the PR page before the slow part: the review may have to
  # queue, and a first-ever run still pays for a checkout.
  set_status pending "preparing the reviewer's workspace"

  # Retire the per-PR reviewer worktrees this script used to create. They are
  # LEGACY: one stable worktree replaced them, nothing writes a
  # `-wt-review-<pr>` directory any more, so PR state no longer gates the
  # sweep — but the removal itself still does.
  #
  # `--disposable`, not the plain teardown: a reviewer leaves scratch files
  # behind (diffs, probe output), and the plain teardown is RIGHT to refuse a
  # dirty tree. The flag forces, and the worktree module's
  # `classifyDisposable()` gates it on a DETACHED head rather than on the
  # directory's name: a worktree with a branch is somebody's working copy
  # and is refused, whatever it is called. Without the worktree module
  # nothing here force-removes unguarded — it TELLS the human instead, on a
  # channel that has a reader. A line in a log file is not a report: two full
  # checkouts sat in seejs.app for days, announced only to
  # `.git/auto-review-<pr>.log`, which nothing and nobody opens.
  for dir in "$(dirname "$MAIN")/$REPO_NAME-wt-review-"*; do
    [ -d "$dir" ] || continue
    old=${dir##*"$REPO_NAME-wt-review-"}
    case "$old" in ''|*[!0-9]*) continue ;; esac
    if [ -f "$MAIN/scripts/teardown-worktree.mts" ]; then
      echo "retiring the legacy reviewer worktree of #$old" >>"$LOG"
      (cd "$MAIN" && "$PKG" run worktree:teardown -- --disposable "$dir") >>"$LOG" 2>&1 || true
      ref=$(workspace_ref "review #$old")
      [ -n "$ref" ] && { cmux_log workspace close "$ref" || true; }
    else
      echo "leftover reviewer worktree of #$old: $dir — remove it yourself (no worktree module to judge it)" >>"$LOG"
      CMUX_QUIET=1 cmux notify --title "auto-review: leftover worktree" \
        --body "$dir — remove it yourself (no worktree module to judge it)" \
        >/dev/null 2>&1 || true
    fi
  done

  # The reviewer's checkout: ONE per repository, created on first use and
  # kept. Detached, never carrying a branch — the PR's branch is checked out
  # in the author's worktree, and git allows a branch in only one. The reset
  # to THIS PR's head is the inner half's job, after the lock; see there for
  # why it cannot happen now.
  if [ ! -d "$WORKTREE" ]; then
    git fetch origin "pull/$PR/head" >>"$LOG" 2>&1 || \
      git fetch origin --prune >>"$LOG" 2>&1
    echo "creating $WORKTREE detached at $HEAD_SHA" >>"$LOG"
    if ! git worktree add --detach "$WORKTREE" "$HEAD_SHA" >>"$LOG" 2>&1; then
      echo "auto-review: could not create $WORKTREE (see $LOG)" >&2
      set_status failure "reviewer worktree could not be created — see the log"
      exit 1
    fi
  fi

  # A newer push supersedes this PR's own still-running review — its verdict
  # would name a stale head. Closing the workspace kills its whole process
  # tree, which is what retires that reviewer (and releases the lock: the
  # wait loop below steals a lock whose holder is gone). Only ever this PR's
  # workspace — another PR's review is a verdict somebody still wants.
  #
  # The pidfile goes FIRST, and that ordering is the whole point: the old
  # review's status watcher is detached, so closing the workspace no longer
  # kills it, and a watcher that saw its reviewer die would file "session
  # ended without a verdict" over the status this launch is about to set.
  # Removing the pidfile is how it is told the review it follows is retired.
  OLD_WS=$(workspace_ref "$WORKSPACE")
  if [ -n "$OLD_WS" ]; then
    echo "superseding the running review ($OLD_WS)" >>"$LOG"
    rm -f "$PIDFILE"
    cmux_log workspace close "$OLD_WS" || true
  fi

  # Beside the author's workspaces, not at the bottom of the sidebar: the
  # review is part of shipping this PR, and a panel you have to hunt for is a
  # panel you stop reading. Ungrouped callers just get the default placement.
  CALLER_WS=$(caller_workspace_ref)
  GROUP=$(caller_group_ref "$CALLER_WS")
  if [ -n "$GROUP" ]; then
    NEW_ACK=$(cmux_q workspace create \
      --name "$WORKSPACE" \
      --cwd "$WORKTREE" \
      --group "$GROUP" \
      --group-placement end \
      --command "AUTO_REVIEW_DETACHED=1 '$MAIN/.agents/auto-review.sh' $PR")
  else
    NEW_ACK=$(cmux_q workspace create \
      --name "$WORKSPACE" \
      --cwd "$WORKTREE" \
      --command "AUTO_REVIEW_DETACHED=1 '$MAIN/.agents/auto-review.sh' $PR")
  fi
  if [ -z "$NEW_ACK" ]; then
    echo "cmux refused to create the workspace." >>"$LOG"
    set_status failure "reviewer workspace could not be created — see the log"
    echo "auto-review: cmux refused to create the workspace (see $LOG)" >&2
    exit 1
  fi
  # The ack is `OK workspace:N`, and only the ref half is a handle. Parsed
  # separately from the guard above on purpose: an unparseable ack means the
  # workspace EXISTS and the review is already running in it, so it downgrades
  # the placement and says so — it is not a failed launch.
  NEW_WS=$(printf '%s\n' "$NEW_ACK" | cmux_ref)

  # Directly UNDER its author, not at the group's end: with several tasks in
  # flight, "end" parks task A's review below task C. Reorder AFTER create,
  # never an anchor on create itself — `--group-reference` refuses a dead ref
  # and the whole create fails with it, whereas a reorder against a vanished
  # author refuses harmlessly and the review simply stays where create put it.
  if [ -z "$NEW_WS" ]; then
    echo "no workspace ref in the create ack ($NEW_ACK) — not reordering" >>"$LOG"
  elif [ -n "$CALLER_WS" ]; then
    cmux_log reorder-workspace --workspace "$NEW_WS" --after "$CALLER_WS" \
      || echo "reorder-workspace refused (exit $?) — the review stays where create put it" >>"$LOG"
  fi
  echo "workspace “${WORKSPACE}” created (${NEW_WS:-$NEW_ACK})" >>"$LOG"
  exit 0
fi

# ===========================================================================
# INNER: runs on the workspace's terminal, in the reviewer's worktree.
# ===========================================================================

{
  echo "=== auto-review PR #$PR (head ${HEAD_SHA:-unknown}) started: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
} >>"$LOG"

# --- the queue -------------------------------------------------------------
# One reviewer worktree per repository means one review at a time, so a
# second PR's review waits here instead of taking the tree away from the
# running one.
#
# `mkdir` is the lock: its create-or-fail is atomic on every POSIX
# filesystem, and it is portable in a way `flock(1)` is not — macOS ships
# without that command. The holder writes "<pr> <pid>" inside, which is what
# lets a waiter tell "someone is reviewing #7" from "someone's workspace was
# closed mid-review": a holder killed with its cmux workspace never runs its
# trap, and its pid is gone, so the lock is stolen rather than waited on
# forever.
LOCK="$GIT_COMMON/auto-review.lock"

waited=0
announced=
while ! mkdir "$LOCK" 2>/dev/null; do
  holder=$(cat "$LOCK/holder" 2>/dev/null)
  # Only "<pr> <pid>" counts as a claim. Anything else is a partial write and
  # falls through to the unclaimed branch below — without this, a one-field
  # file makes pr and pid the same string, `kill -0` on it can succeed
  # against an unrelated process, and the queue waits forever.
  case "$holder" in
    *[0-9]' '[0-9]*) holder_pr=${holder%% *}; holder_pid=${holder##* } ;;
    *) holder=; holder_pr=; holder_pid= ;;
  esac
  if [ -n "$holder_pid" ] && ! kill -0 "$holder_pid" 2>/dev/null; then
    echo "stealing the lock from a dead holder (#${holder_pr:-?}, pid $holder_pid)" >>"$LOG"
    rm -rf "$LOCK"
    continue
  fi
  # A lock with no holder file is a crash between the mkdir and the write.
  # Give it a minute before deciding that, so a live holder mid-write is
  # never mistaken for a corpse.
  if [ -z "$holder" ] && [ "$waited" -ge 60 ]; then
    echo "stealing an unclaimed lock" >>"$LOG"
    rm -rf "$LOCK"
    continue
  fi
  # Once per holder, not once per poll: the wait is unbounded, and a status
  # write every ten seconds is API traffic that says nothing new.
  if [ "$announced" != "${holder_pr:-?}" ]; then
    announced=${holder_pr:-?}
    echo "queued behind the review of #$announced" >>"$LOG"
    set_status pending "queued behind the review of #$announced"
  fi
  sleep 10
  waited=$((waited + 10))
done
printf '%s %s\n' "$PR" "$$" >"$LOCK/holder"
trap 'rm -rf "$LOCK"' EXIT INT TERM

# The head can move while a review sits in the queue. Review what is there
# NOW: everything downstream — the status, the verdict match, the
# announcement — keys off this value, and a queued review that verified the
# head it was launched with would file a verdict about a diff the PR no
# longer proposes.
FRESH_SHA=$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)
[ -n "$FRESH_SHA" ] && HEAD_SHA="$FRESH_SHA"

set_status pending "reviewer running — verdict lands as a PR comment"

# Now the tree is this review's alone: point it at the PR head.
git fetch origin "pull/$PR/head" >>"$LOG" 2>&1 || \
  git fetch origin --prune >>"$LOG" 2>&1
echo "resetting $WORKTREE to $HEAD_SHA" >>"$LOG"
if ! git -C "$WORKTREE" reset --hard "$HEAD_SHA" >>"$LOG" 2>&1; then
  echo "auto-review: could not reset $WORKTREE to $HEAD_SHA (see $LOG)" >&2
  set_status failure "reviewer worktree could not be reset — see the log"
  exit 1
fi
# The previous review's scratch. `clean -fd` leaves IGNORED files alone, so
# node_modules survives and the install below is skipped — which is the point
# of keeping one worktree. Probe files a repo keeps in an ignored directory
# survive too; the review skill's own rule (delete probes before the verdict)
# is what covers those.
git -C "$WORKTREE" clean -fd >>"$LOG" 2>&1 || true

# The reviewer runs the local gate, so it needs the same provisioning any
# worktree gets: with the worktree module, an allowlisted `.env` (secrets
# withheld — this is another vendor's model) plus the install; without it,
# the plain install. Skipped once the worktree has node_modules, which is
# every review after the first.
if [ ! -d "$WORKTREE/node_modules" ]; then
  echo "provisioning $WORKTREE" >>"$LOG"
  if [ -f "$MAIN/scripts/setup-worktree.mts" ]; then
    (cd "$WORKTREE" && "$PKG" run worktree:setup) >>"$LOG" 2>&1 || {
      echo "auto-review: worktree:setup failed in $WORKTREE (see $LOG)" >&2
      set_status failure "reviewer worktree could not be provisioned — see the log"
      exit 1
    }
  else
    (cd "$WORKTREE" && $INSTALL) >>"$LOG" 2>&1 || {
      echo "auto-review: install failed in $WORKTREE (see $LOG)" >&2
      set_status failure "reviewer worktree could not be provisioned — see the log"
      exit 1
    }
  fi
fi

# The PROMPT is this script's, not the rendered line's — because it must
# carry the one fact a reviewer session may never have to hunt for: the
# absolute path of the repository under review. A session that starts
# without its workspace attached and is told only "this repository" goes
# LOOKING for the repo — across the human's home directory, one permission
# prompt per read, a storm with a lost agent behind it (seejs.app review
# of PR #29, live). With the path pinned and leaving it forbidden, that
# failure mode is harmless whatever detached the workspace. This shell
# runs IN the reviewer worktree (the workspace was created with --cwd), so
# $PWD is exact. The rendered REVIEW_CMD passes it as "$REVIEW_PROMPT" —
# prompt fixes reach every adopted repo through an ordinary sync, while
# the CLI, model and flags stay the repo's local choice.
REVIEW_PROMPT="You are the independent reviewer for pull request #$PR of the repository at $PWD — that exact directory, already checked out at the PR head. Every file you need is inside it: never read, list, search or WRITE anywhere outside $PWD — your file grants end at that directory, and one touch outside it (a diff saved to /tmp, a note in \$HOME) stalls the review on a permission prompt. Scratch files — saved diffs, notes, probe output — go under $PWD/tmp/. Read $PWD/.agents/skills/review/SKILL.md and follow it exactly. You are the reviewer, not the author: never push, never merge, never close. The deliverable is the verdict COMMENT on the PR — a verdict that stays in this transcript did not happen."
export REVIEW_PROMPT

# This shell's pid, not the CLI's: an interactive CLI holds the terminal in
# the foreground, so it has no pid of its own to record here. Closing the
# workspace is what stops a review (it kills the whole tree); the pidfile is
# the fallback for a workspace that is no longer reachable.
#
# Written BEFORE the watcher starts, not after: the pidfile is also how the
# watcher tells its own review from the one that superseded it, and a watcher
# whose first tick finds no pidfile would retire itself immediately.
echo "$$" >"$PIDFILE"

# The status watcher — see POLL above for what it is for and why it is a
# process rather than the background subshell this used to be.
#
# perl is here for exactly one call, setsid(2): macOS ships no setsid(1), and
# perl is the one interpreter it and every Linux already have. A setsid that
# fails (the child is already a process-group leader) is not fatal — exec runs
# regardless and the watcher simply stays in the tree, which is where it lived
# before. Without perl at all the watcher still runs, still ends the "reviewer
# sits on a prompt" silence, and only loses the case where the workspace is
# closed under it; say which of the two is running, because the difference is
# invisible until the day it matters.
if command -v perl >/dev/null 2>&1; then
  AUTO_REVIEW_POLL="$$" AUTO_REVIEW_POLL_HEAD="$HEAD_SHA" \
    perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec: $!"' -- \
      /bin/sh "$0" "$PR" >>"$LOG" 2>&1 </dev/null &
  POLLER=$!
  POLLER_DETACHED=1
else
  echo "no perl: the status watcher runs in this tree and dies with the workspace" >>"$LOG"
  AUTO_REVIEW_POLL="$$" AUTO_REVIEW_POLL_HEAD="$HEAD_SHA" \
    /bin/sh "$0" "$PR" >>"$LOG" 2>&1 </dev/null &
  POLLER=$!
  POLLER_DETACHED=
fi

{{REVIEW_CMD}}
STATUS=$?

# Retire the watcher and WAIT for it to be gone before reading the verdict
# below. It may be mid-`gh api` with a "no verdict after 2h" restatement, and
# a write that lands after this one leaves a finished review sitting at
# pending — precisely the bug the watcher exists to prevent. The whole session
# and not just its shell, because that in-flight `gh` is a child of it; the
# detached watcher is a session leader, so the negative pid is its own group
# and nothing else's. The in-tree fallback shares THIS shell's group, so it
# gets a plain kill — a group signal there would take the reviewer with it.
if [ -n "$POLLER_DETACHED" ]; then
  kill -TERM "-$POLLER" 2>/dev/null
else
  kill -TERM "$POLLER" 2>/dev/null
fi
wait "$POLLER" 2>/dev/null

echo "=== auto-review PR #$PR exited $STATUS ===" >>"$LOG"

# The truth is the comment, not the exit code: a reviewer that exited 0
# without posting still failed, and one that posted before dying still
# delivered.
if [ -n "$HEAD_SHA" ]; then
  SHORT=$(printf '%.7s' "$HEAD_SHA")
  if verdict_posted; then
    set_status success "verdict posted for $SHORT — read it before merging"
    announce_verdict
  else
    set_status failure "no verdict for $SHORT (exit $STATUS) — see $LOG"
  fi
fi

rm -f "$PIDFILE"
exit $STATUS
