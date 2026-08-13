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
# lands (a poller watches for it, since an interactive session outlives its
# review), red when the session ends without one. The verdict is ALWAYS the
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
HEAD_SHA=$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)

set_status() { # $1 = pending|success|failure, $2 = description
  [ -n "$HEAD_SHA" ] || return 0
  gh api "repos/{owner}/{repo}/statuses/$HEAD_SHA" \
    -f state="$1" -f context=auto-review -f description="$2" \
    >/dev/null 2>&1 || true
}

cmux_q() { CMUX_QUIET=1 cmux "$@" 2>/dev/null; }

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
# The chain is convention the worktree module already guarantees: the PR's
# branch names the worktree (`<repo>-wt-<name>`), the `<name>` names the
# workspace `task:start` opened for it — and workspace_ref() answers only on
# an unambiguous title match, so a renamed or duplicated workspace yields
# nothing rather than a guess.
author_workspace_ref() {
  AUTHOR_BRANCH=$(gh pr view "$PR" --json headRefName --jq .headRefName 2>/dev/null)
  [ -n "$AUTHOR_BRANCH" ] || return 0
  AUTHOR_WT=$(git worktree list --porcelain | awk -v b="branch refs/heads/$AUTHOR_BRANCH" '
    /^worktree / { path = substr($0, 10) }
    $0 == b { print path; exit }')
  case "$AUTHOR_WT" in
    *-wt-*) workspace_ref "${AUTHOR_WT##*-wt-}" ;;
  esac
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
  # The VERDICT line of the comment whose Reviewed-by names this head.
  VERDICT=$(gh pr view "$PR" --json comments --jq '.comments[].body' 2>/dev/null \
    | awk -v s="head $SHORT" 'index($0, s) {f=1} f && /VERDICT:/ {print; exit}' \
    | grep -oiE 'VERDICT: *[a-z]+' | tail -1)
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
      # The fix loop starts itself: the author's session receives the verdict
      # as an ordinary user message and goes to work before the human has
      # even read it. `cmux send` into a live interactive session is probed
      # behavior (2026-08-13): the text lands as a user turn and queues
      # cleanly even while the agent is mid-task. Approve sends nothing —
      # what follows an approve (hand-test, merge) is the human's, not an
      # agent's. Best-effort at every step: a closed or renamed author
      # workspace answers nothing above, and the desktop notification stays
      # the only announcement.
      AUTHOR_WS=$(author_workspace_ref)
      if [ -n "$AUTHOR_WS" ]; then
        CMUX_QUIET=1 cmux send --workspace "$AUTHOR_WS" -- \
          "auto-review of PR #$PR: BLOCKER — read the reviewer's verdict comment on the PR, fix the blockers, then /ship to re-review.\n" \
          >>"$LOG" 2>&1 || true
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
      [ -n "$ref" ] && cmux_q workspace close "$ref" >>"$LOG" 2>&1
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
  OLD_WS=$(workspace_ref "$WORKSPACE")
  if [ -n "$OLD_WS" ]; then
    echo "superseding the running review ($OLD_WS)" >>"$LOG"
    cmux_q workspace close "$OLD_WS" >>"$LOG" 2>&1
  fi

  # Beside the author's workspaces, not at the bottom of the sidebar: the
  # review is part of shipping this PR, and a panel you have to hunt for is a
  # panel you stop reading. Ungrouped callers just get the default placement.
  CALLER_WS=$(caller_workspace_ref)
  GROUP=$(caller_group_ref "$CALLER_WS")
  if [ -n "$GROUP" ]; then
    NEW_WS=$(cmux_q workspace create \
      --name "$WORKSPACE" \
      --cwd "$WORKTREE" \
      --group "$GROUP" \
      --group-placement end \
      --command "AUTO_REVIEW_DETACHED=1 '$MAIN/.agents/auto-review.sh' $PR")
  else
    NEW_WS=$(cmux_q workspace create \
      --name "$WORKSPACE" \
      --cwd "$WORKTREE" \
      --command "AUTO_REVIEW_DETACHED=1 '$MAIN/.agents/auto-review.sh' $PR")
  fi
  if [ -z "$NEW_WS" ]; then
    echo "cmux refused to create the workspace." >>"$LOG"
    set_status failure "reviewer workspace could not be created — see the log"
    echo "auto-review: cmux refused to create the workspace (see $LOG)" >&2
    exit 1
  fi

  # Directly UNDER its author, not at the group's end: with several tasks in
  # flight, "end" parks task A's review below task C. Reorder AFTER create,
  # never an anchor on create itself — `--group-reference` refuses a dead ref
  # and the whole create fails with it, whereas a reorder against a vanished
  # author refuses harmlessly and the review simply stays where create put it.
  if [ -n "$CALLER_WS" ]; then
    cmux_q reorder-workspace --workspace "$NEW_WS" --after "$CALLER_WS" \
      >>"$LOG" 2>&1 || true
  fi
  echo "workspace “$WORKSPACE” created ($NEW_WS)" >>"$LOG"
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

# Has a verdict naming this head been posted?
verdict_posted() {
  [ -n "$HEAD_SHA" ] || return 1
  SHORT=$(printf '%.7s' "$HEAD_SHA")
  gh pr view "$PR" --json comments --jq '.comments[].body' 2>/dev/null \
    | grep -q "head $SHORT"
}

# An interactive session outlives the review itself (the terminal stays
# open), so the status cannot wait for the process to exit: this poller
# flips it green the moment the verdict comment appears.
(
  # This subshell must never release the review's lock: it exits as soon as
  # the verdict lands, while the reviewer's terminal is still open.
  trap - EXIT INT TERM
  waited=0
  while [ "$waited" -lt 3600 ]; do
    sleep 60
    waited=$((waited + 60))
    if verdict_posted; then
      set_status success "verdict posted for $(printf '%.7s' "$HEAD_SHA") — read it before merging"
      announce_verdict
      exit 0
    fi
  done
) &
POLLER=$!

# This shell's pid, not the CLI's: an interactive CLI holds the terminal in
# the foreground, so it has no pid of its own to record here. Closing the
# workspace is what stops a review (it kills the whole tree); the pidfile is
# the fallback for a workspace that is no longer reachable.
echo "$$" >"$PIDFILE"

{{REVIEW_CMD}}
STATUS=$?

kill "$POLLER" 2>/dev/null

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
