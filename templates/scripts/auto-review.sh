#!/bin/sh
# Launched detached by the `ship` skill right after a PR is opened or updated:
# runs ONE headless session of this repo's chosen reviewer CLI, which follows
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
#   - the reviewer REPORTS; it never pushes. Where the CLI's permission
#     config supports a deny list, adoption sets it to refuse `git push`,
#     `gh pr merge` and `gh pr close` outright; where it supports none, the
#     human accepted at adoption that the `review` skill's report-only
#     protocol is the only guard — the adoption summary records which of
#     the two THIS repo has.
#
# Output goes to a per-PR log under .git/ (per-clone, never committed) — some
# CLIs drop stdout on a non-TTY, and the deliverable is the PR comment anyway.
# The log is for the human debugging a review that never landed.

PR="$1"
case "$PR" in
  ''|*[!0-9]*) echo "usage: auto-review.sh <pr-number>" >&2; exit 2 ;;
esac

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || {
  echo "auto-review: not inside a git repository" >&2
  exit 1
}
PIDFILE="$GIT_DIR/auto-review-$PR.pid"
LOG="$GIT_DIR/auto-review-$PR.log"

OLD_PID=""
[ -f "$PIDFILE" ] && OLD_PID=$(cat "$PIDFILE" 2>/dev/null)

{
  echo "=== auto-review PR #$PR started: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
} >>"$LOG"

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
[ "$(cat "$PIDFILE" 2>/dev/null)" = "$CHILD" ] && rm -f "$PIDFILE"

echo "=== auto-review PR #$PR exited $STATUS ===" >>"$LOG"
exit $STATUS
