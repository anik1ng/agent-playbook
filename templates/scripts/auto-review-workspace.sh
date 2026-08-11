#!/bin/sh
# The WORKSPACE render base for `.agents/auto-review.sh` — chosen at adoption
# via the playbook's `integrations/cmux.md` instead of the default headless
# base (`templates/scripts/auto-review.sh`). Same destination, same caller
# (the `ship` skill), same contract with the outside: one fresh session of
# this repo's chosen reviewer CLI follows `.agents/skills/review/SKILL.md`
# and posts its verdict as a comment on the PR.
#
# What this base does differently, and why:
#
#   - the review runs on a VISIBLE terminal in a cmux workspace, beside the
#     author's, instead of as a detached background process. A visible
#     session can be watched, and — where the reviewer CLI's machine layer
#     answers "ask" rather than "allow" for a tool — the human on this
#     terminal is who answers. Headless has nobody to answer; this base
#     exists for setups that keep a human near the review.
#   - the reviewer gets its OWN worktree, detached on the PR head
#     (`<repo>-wt-review-<pr>`), persistent per PR: a fix push resets it
#     instead of paying provisioning again. Detached, because the branch is
#     checked out in the author's worktree and git allows a branch in one.
#   - reviewer worktrees of CLOSED/MERGED PRs are retired on the next
#     launch — via `worktree:teardown --disposable` where the worktree
#     module is installed (its predicate refuses anything with a branch).
#
# The REVIEW_CMD line below is this repo's one local part (the playbook's
# UPDATE.md keeps it across syncs): the reviewer CLI's command line, rendered
# at adoption after checking the CLI's own --help. This comment names it
# WITHOUT the template braces on purpose — the rendered script must pass
# ADOPT.md's "no surviving placeholders" grep. Its contract is the same as
# the headless base's, with ONE relaxation: it runs on a real terminal, so
# it MAY be interactive. Everything else holds — scoped to the reviewer's
# worktree, no blanket permission bypass, push/merge/close machine-denied,
# the model named explicitly.
#
# The human watches the PR page, not this terminal — so the process reports
# there: an `auto-review` commit status on the PR's head, pending at launch,
# then success ("verdict posted") or failure ("no verdict — see the log").
# An interactive session outlives its review, so a poller flips the status
# green the moment the verdict comment appears rather than waiting for exit.
# The verdict itself is ALWAYS the comment — a green status is not approval.

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
workspace_ref() {
  cmux_q workspace list --json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const m = JSON.parse(s).workspaces.filter((w) => w.title === process.argv[1]);
        if (m.length === 1) process.stdout.write(m[0].ref);
      } catch {}
    });
  ' "$1" 2>/dev/null
}

# The workspace group the CALLER sits in, or nothing.
#
# Without this the reviewer lands outside the author's group, at the bottom of
# the sidebar, which is exactly where you do not look for it. cmux reports
# membership only from the group side (`workspace-group list`), never on the
# workspace, so the caller's own ref has to be matched against the members.
caller_group_ref() {
  caller=$(cmux_q identify | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { process.stdout.write(JSON.parse(s).caller.workspace_ref ?? ""); } catch {}
    });
  ' 2>/dev/null)
  [ -n "$caller" ] || return 0
  cmux_q workspace-group list --json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const g = JSON.parse(s).groups.find((g) =>
          (g.member_workspace_refs ?? []).includes(process.argv[1]));
        if (g) process.stdout.write(g.ref);
      } catch {}
    });
  ' "$caller" 2>/dev/null
}

WORKSPACE="review #$PR"

# ===========================================================================
# OUTER: prepare the reviewer's checkout, hand the review to a workspace.
#
# Detach here, not in the caller: the ship skill invokes this script plainly,
# so the launch mechanics are THIS file's business — a machine that runs its
# reviewer differently re-renders only this script, never the vendor-neutral
# skill.
# ===========================================================================

if [ -z "$AUTO_REVIEW_DETACHED" ]; then
  MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
  REPO_NAME=$(basename "$MAIN")
  WORKTREE="$(dirname "$MAIN")/$REPO_NAME-wt-review-$PR"

  {
    echo "=== auto-review PR #$PR (head ${HEAD_SHA:-unknown}) launching: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
  } >>"$LOG"

  if ! command -v cmux >/dev/null 2>&1 || ! cmux_q ping >/dev/null 2>&1; then
    # No silent fallback to a background run: this base was chosen because a
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

  # Say something on the PR page before the slow part: provisioning a fresh
  # reviewer worktree costs an install.
  set_status pending "preparing the reviewer's workspace"

  # Retire the reviewer worktrees of PRs that are done. This is the only
  # moment anything runs on a schedule, so it is where the cleanup lives.
  #
  # `--disposable`, not the plain teardown: a reviewer leaves scratch files
  # behind (diffs, probe output), and the plain teardown is RIGHT to refuse a
  # dirty tree — so that path never fires, and every reviewed PR quietly
  # keeps a full checkout's disk. The flag forces, and the worktree module's
  # `classifyDisposable()` gates it on a DETACHED head rather than on the
  # directory's name: a worktree with a branch is somebody's working copy
  # and is refused, whatever it is called. Without the worktree module the
  # leftovers are only reported — nothing here force-removes unguarded.
  for dir in "$(dirname "$MAIN")/$REPO_NAME-wt-review-"*; do
    [ -d "$dir" ] || continue
    old=${dir##*"$REPO_NAME-wt-review-"}
    case "$old" in ''|*[!0-9]*) continue ;; esac
    [ "$old" = "$PR" ] && continue
    state=$(gh pr view "$old" --json state --jq .state 2>/dev/null)
    if [ -n "$state" ] && [ "$state" != "OPEN" ]; then
      if [ -f "$MAIN/scripts/teardown-worktree.mts" ]; then
        echo "retiring the reviewer worktree of #$old ($state)" >>"$LOG"
        (cd "$MAIN" && {{PKG_MANAGER}} run worktree:teardown -- --disposable "$dir") >>"$LOG" 2>&1 || true
        ref=$(workspace_ref "review #$old")
        [ -n "$ref" ] && cmux_q workspace close "$ref" >>"$LOG" 2>&1
      else
        echo "leftover reviewer worktree of #$old ($state): $dir — remove it yourself (no worktree module to judge it)" >>"$LOG"
      fi
    fi
  done

  # The reviewer's checkout is DETACHED on the PR head: the branch itself is
  # checked out in the author's worktree, and git allows a branch in only one.
  # It is persistent per PR — a fix push resets it rather than paying the
  # install again.
  git fetch origin "pull/$PR/head" >>"$LOG" 2>&1 || \
    git fetch origin --prune >>"$LOG" 2>&1
  if [ -d "$WORKTREE" ]; then
    echo "reusing $WORKTREE — resetting to $HEAD_SHA" >>"$LOG"
    if ! git -C "$WORKTREE" reset --hard "$HEAD_SHA" >>"$LOG" 2>&1; then
      echo "auto-review: could not reset $WORKTREE to $HEAD_SHA (see $LOG)" >&2
      set_status failure "reviewer worktree could not be reset — see the log"
      exit 1
    fi
  else
    echo "creating $WORKTREE detached at $HEAD_SHA" >>"$LOG"
    if ! git worktree add --detach "$WORKTREE" "$HEAD_SHA" >>"$LOG" 2>&1; then
      echo "auto-review: could not create $WORKTREE (see $LOG)" >&2
      set_status failure "reviewer worktree could not be created — see the log"
      exit 1
    fi
  fi

  # The reviewer runs the local gate, so it needs the same provisioning any
  # worktree gets: with the worktree module, an allowlisted `.env` (secrets
  # withheld — this is another vendor's model) plus the install; without it,
  # the plain install. Skipped when node_modules is already there, which is
  # every fix push after the first.
  if [ ! -d "$WORKTREE/node_modules" ]; then
    echo "provisioning $WORKTREE" >>"$LOG"
    if [ -f "$MAIN/scripts/setup-worktree.mts" ]; then
      (cd "$WORKTREE" && {{PKG_MANAGER}} run worktree:setup) >>"$LOG" 2>&1 || {
        echo "auto-review: worktree:setup failed in $WORKTREE (see $LOG)" >&2
        set_status failure "reviewer worktree could not be provisioned — see the log"
        exit 1
      }
    else
      (cd "$WORKTREE" && {{INSTALL_CMD}}) >>"$LOG" 2>&1 || {
        echo "auto-review: install failed in $WORKTREE (see $LOG)" >&2
        set_status failure "reviewer worktree could not be provisioned — see the log"
        exit 1
      }
    fi
  fi

  # A newer push supersedes a still-running review — its verdict would name a
  # stale head. Closing the workspace kills its whole process tree, which is
  # what retires the previous reviewer.
  OLD_WS=$(workspace_ref "$WORKSPACE")
  if [ -n "$OLD_WS" ]; then
    echo "superseding the running review ($OLD_WS)" >>"$LOG"
    cmux_q workspace close "$OLD_WS" >>"$LOG" 2>&1
  fi

  # Beside the author's workspaces, not at the bottom of the sidebar: the
  # review is part of shipping this PR, and a panel you have to hunt for is a
  # panel you stop reading. Ungrouped callers just get the default placement.
  GROUP=$(caller_group_ref)
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
  echo "workspace “$WORKSPACE” created ($NEW_WS)" >>"$LOG"
  exit 0
fi

# ===========================================================================
# INNER: runs on the workspace's terminal, in the reviewer's worktree.
# ===========================================================================

{
  echo "=== auto-review PR #$PR (head ${HEAD_SHA:-unknown}) started: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
} >>"$LOG"

set_status pending "reviewer running — verdict lands as a PR comment"

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
  waited=0
  while [ "$waited" -lt 3600 ]; do
    sleep 60
    waited=$((waited + 60))
    if verdict_posted; then
      set_status success "verdict posted for $(printf '%.7s' "$HEAD_SHA") — read it before merging"
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
  else
    set_status failure "no verdict for $SHORT (exit $STATUS) — see $LOG"
  fi
fi

rm -f "$PIDFILE"
exit $STATUS
