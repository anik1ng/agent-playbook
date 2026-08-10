#!/bin/sh
# Launched by the `ship` skill right after a PR is opened or updated; detaches
# ITSELF (see below), so the skill just runs it plainly and moves on. It runs
# ONE headless session of this repo's chosen reviewer CLI, which follows
# `.agents/skills/review/SKILL.md` and posts its verdict as a comment on the PR.
# A spawned headless process is a fresh session — zero shared context with the
# author — so the "a FRESH session reviews" rule holds; cross-family is a
# property of which CLI was chosen at adoption.
#
# `{{REVIEW_CMD}}` is this repo's one local part (the playbook's UPDATE.md keeps
# it across syncs): the reviewer CLI's headless command line, rendered at
# adoption after checking the CLI's own --help. Its contract:
#
#   - it references "$PR" (the PR number this script was invoked with);
#   - it runs the CLI in headless/non-interactive mode with permissions wide
#     enough for the review protocol (probe tests, mutation runs, the local
#     gate, `gh`) — a soft-denied tool hollows the review out silently;
#   - "wide" means tools, never reach: the run stays scoped to this working
#     copy (the CLI's sandbox / workspace-trust / allowed-directories
#     mechanism, per ADOPT.md's "Reviewer CLI" step) and is never launched
#     with a blanket permission bypass — a bypass does not widen the toolset,
#     it dissolves the boundary around the repo;
#   - the reviewer REPORTS; it never pushes. Where the CLI's permission
#     config supports a deny list, adoption sets it to refuse `git push`,
#     `gh pr merge` and `gh pr close` outright; where it supports none, the
#     human accepted at adoption that the `review` skill's report-only
#     protocol is the only guard — the adoption summary records which of
#     the two THIS repo has.
#
# The human watches the PR page, not this process — so the process reports
# there: an `auto-review` commit status on the PR's head, pending at launch,
# then success ("verdict posted") or failure ("no verdict — see the log").
# The status answers "is a review running / did it die"; the verdict itself is
# ALWAYS the comment — a green auto-review status is not an approval.
#
# Output goes to a per-PR log under .git/ (per-clone, never committed) — some
# CLIs drop stdout on a non-TTY, and the deliverable is the PR comment anyway.
# The log is for the human debugging a review that never landed.

PR="$1"
case "$PR" in
  ''|*[!0-9]*) echo "usage: auto-review.sh <pr-number>" >&2; exit 2 ;;
esac

# Detach here, not in the caller: the ship skill invokes this script plainly,
# so the launch mechanics are THIS file's business — a machine that runs its
# reviewer differently (a terminal-multiplexer session, a container) re-renders
# only this script, never the vendor-neutral skill. Default: re-exec into the
# background, disowned from the caller's tty.
if [ -z "$AUTO_REVIEW_DETACHED" ]; then
  AUTO_REVIEW_DETACHED=1 nohup "$0" "$PR" >/dev/null 2>&1 &
  exit 0
fi

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || {
  echo "auto-review: not inside a git repository" >&2
  exit 1
}
PIDFILE="$GIT_DIR/auto-review-$PR.pid"
LOG="$GIT_DIR/auto-review-$PR.log"

# Visibility is best-effort by design: if gh or the network is down, the
# review still runs and the log still fills — only the PR-page signal is lost.
HEAD_SHA=$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null)

set_status() { # $1 = pending|success|failure, $2 = description
  [ -n "$HEAD_SHA" ] || return 0
  gh api "repos/{owner}/{repo}/statuses/$HEAD_SHA" \
    -f state="$1" -f context=auto-review -f description="$2" \
    >/dev/null 2>&1 || true
}

OLD_PID=""
[ -f "$PIDFILE" ] && OLD_PID=$(cat "$PIDFILE" 2>/dev/null)

{
  echo "=== auto-review PR #$PR (head ${HEAD_SHA:-unknown}) started: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
} >>"$LOG"

set_status pending "reviewer running — verdict lands as a PR comment"

{{REVIEW_CMD}} >>"$LOG" 2>&1 &
CHILD=$!
echo "$CHILD" >"$PIDFILE"

# A newer push supersedes a still-running review — its verdict would name a
# stale head. Kill the predecessor only AFTER claiming the pidfile: its
# wrapper wakes on the kill, and the guard on cleanup below must already see
# our pid in the file, or it would remove it and orphan us the same way.
[ -n "$OLD_PID" ] && kill "$OLD_PID" 2>/dev/null

wait "$CHILD"
STATUS=$?
# Only clean up our own pidfile: if a newer launch superseded us while we ran,
# the file now holds ITS pid, and deleting it would orphan that reviewer.
IS_CURRENT=false
[ "$(cat "$PIDFILE" 2>/dev/null)" = "$CHILD" ] && IS_CURRENT=true
[ "$IS_CURRENT" = true ] && rm -f "$PIDFILE"

echo "=== auto-review PR #$PR exited $STATUS ===" >>"$LOG"

# Superseded → say nothing: the newer launch owns the PR-page signal now.
# Otherwise the truth is the comment, not the exit code: a reviewer that
# exited 0 without posting still failed, and one that posted before dying
# still delivered.
if [ "$IS_CURRENT" = true ] && [ -n "$HEAD_SHA" ]; then
  SHORT=$(printf '%.7s' "$HEAD_SHA")
  if gh pr view "$PR" --json comments --jq '.comments[].body' 2>/dev/null \
      | grep -q "head $SHORT"; then
    set_status success "verdict posted for $SHORT — read it before merging"
  else
    set_status failure "no verdict for $SHORT (exit $STATUS) — see .git/auto-review-$PR.log"
  fi
fi

exit $STATUS
