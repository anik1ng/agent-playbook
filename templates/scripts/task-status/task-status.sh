#!/bin/sh
# The cmux sidebar pill for a TASK workspace. Five states, and the whole point
# of the design is what AMBER means: "this agent cannot proceed without you",
# never "this agent went quiet".
#
#   Working              hammer, sky      lane auto            + elapsed turn time
#   Waiting for you      bell,   amber    lane needs-attention
#   Asked you a question bell,   amber    lane needs-attention
#   Background work      gear,   slate    lane auto
#   Finished             check,  slate    lane auto
#
# Wired from `.claude/settings.json`; a silent no-op anywhere else.
#
# Why this exists at all (a live incident). cmux ships its own Claude wrapper, and
# it owns the `claude_code` status key. That wrapper writes `Needs input` when
# the agent asks for permission and CLEARS the pill when the human answers,
# without writing `Running` back — so the surface the human actually watches
# goes blank for the entire rest of the run, while the wrapper's own lifecycle
# record stays stuck on `needsInput`. Two stores disagree and the sidebar reads
# the empty one. A session that never hits a prompt keeps reporting correctly,
# which is what makes the bug easy to miss.
#
# Why FIVE states and not two (a live incident). The first version mapped "needs you"
# onto `Stop` and "working" onto `PreToolUse`, and both events are blind to the
# fact being reported: `Stop` fires the same way for "I asked you something" and
# "I finished, nothing needed", and `PreToolUse` fires the same way for "running
# a command" and "asking you a question" — `AskUserQuestion` is a tool call. So
# a finished report demanded attention while a session sitting on an open dialog
# stayed quiet. The fix is to take the fact from events that carry it:
# `PermissionRequest` for a permission ask, a tool-name MATCHER for the blocking
# tools, and `last_assistant_message` on `Stop` for a prose question.
#
# RE-ASSERT, DO NOT TRANSITION. The state is written on EVERY event, not once at
# turn start. Edge-triggered state is precisely what broke in cmux: one missed
# event and the pill is wrong until the workspace closes. Re-assertion self-heals
# on the next tool call, and a working agent makes dozens a minute.
#
# OUR OWN KEY, `task`. `claude_code` belongs to cmux; this pill sits beside it
# rather than fighting it. Priority 80 — deliberately BELOW the 90 that
# `auto-review.sh` uses for its `review` key, so while a review of this
# workspace's PR is running, the review's transient state sorts above the
# steady one this script writes. auto-review.sh also CLEARS this key when it
# swaps its review pill onto the workspace: sorting decides order, not
# removal, and a `Finished` left underneath asserted the opposite of the
# review pill above it. That clear loses nothing — the next event re-asserts
# (see RE-ASSERT above), which is exactly the self-healing it leans on.
#
# This file lives in `.agents/` and not in `.claude/settings.json` because the
# logic is meant to be ported to agent-playbook, where `.agents/*` is synced
# byte-for-byte while a `hooks` block in `settings.json` would never reach an
# adopted repo. Logic travels; wiring stays local.
#
# Stdin is read on `stop` and NOWHERE ELSE. Claude Code writes the hook payload
# there and closes it, but a hook that drains stdin unconditionally hangs when
# the script is run by hand from a terminal — hence the `[ -t 0 ]` guard, and
# hence keeping every high-frequency state off that path entirely.
#
# THE HOOK COMMANDS IN settings.json END IN `|| true`, and that is load-bearing
# rather than decorative. The `exit 64` below protects against a bad ARGUMENT,
# but nothing in this file can protect against this file failing to PARSE: `sh`
# exits 2 on a syntax error, and a PreToolUse hook that exits 2 blocks the tool
# call. A half-written version of this script therefore freezes the agent it is
# supposed to be reporting on — observed, not theorised, while writing this very
# version. `|| true` in the wiring makes a broken pill degrade to no pill.

ARG="$1"

case "$ARG" in
  prompt | working | blocked | stop | clear) ;;
  *)
    echo "usage: task-status.sh <prompt|working|blocked|stop|clear>" >&2
    # 64 (EX_USAGE) and never 2 — see the note above on why 2 is the dangerous
    # exit code here.
    exit 64
    ;;
esac

# Outside cmux there is no sidebar to write to. Exit before touching anything,
# including the cache — a hook that leaves droppings on a machine it cannot
# help is a hook that gets deleted.
[ -n "$CMUX_WORKSPACE_ID" ] || exit 0
command -v cmux >/dev/null 2>&1 || exit 0

CACHE="${TMPDIR:-/tmp}/cmux-task-status-$CMUX_WORKSPACE_ID"
HERE=$(dirname "$0")
now=$(date +%s)

# Cache record: `<state> <written-at> <turn-start>`. A record written by an
# older version, truncated, or scribbled on by something else must re-assert
# rather than throw, so anything non-numeric reads as "long ago" / "unknown".
last_state=''
last_at=0
turn_start=0
if [ -r "$CACHE" ]; then
  read -r last_state last_at turn_start _rest <"$CACHE" 2>/dev/null || true
fi
case "$last_at" in '' | *[!0-9]*) last_at=0 ;; esac
case "$turn_start" in '' | *[!0-9]*) turn_start=0 ;; esac

# ---------------------------------------------------------------------------
# `stop` is the only argument that is not already a state: it has to choose
# between three of them, and it is the only one that reads the hook payload.
#
# The choosing lives in `task-status-stop.mjs` and not here because it is JSON
# work, and a shell script that parses JSON with sed is a bug waiting for a
# message containing a quote. It costs one node start per TURN — the
# lowest-frequency event this script handles — against the ~155ms cmux call the
# same invocation is about to make anyway.
# ---------------------------------------------------------------------------
resolve_stop() {
  # Run by hand from a terminal: no payload is coming, and draining a TTY hangs.
  if [ -t 0 ]; then
    echo done
    return
  fi
  # No node, no parse. Degrading to `done` keeps the pill honest-but-quiet
  # rather than guessing; a machine without node simply never gets the amber
  # prose-question state.
  if ! command -v node >/dev/null 2>&1; then
    echo done
    return
  fi
  resolved=$(node "$HERE/task-status-stop.mjs" 2>/dev/null)
  case "$resolved" in
    asked | background | done) echo "$resolved" ;;
    *) echo done ;;
  esac
}

case "$ARG" in
  # UserPromptSubmit: the one event that means "a new turn just began", so it
  # is the only place the turn clock is reset.
  prompt)
    STATE=working
    turn_start=$now
    ;;
  stop) STATE=$(resolve_stop) ;;
  *) STATE="$ARG" ;;
esac

# ---------------------------------------------------------------------------
# Elapsed turn time — `Working` only (decided live).
#
# Under a minute the pill reads plain `Working`: most turns are short, and a
# `0m` that means nothing churns the sidebar. From 1m it reads `Working 5m`,
# which is when a run starts being worth noticing. No clock on any other state
# — a frozen timer reads as a stuck pill, which is why `Background work` has
# none even though it is the state that tends to last longest.
#
# KNOWN LIMIT: the pill only updates when a hook fires, so during a single long
# tool call (a 10-minute `docker build`) the number stands still. Documented in
# docs/RUNBOOK.md rather than papered over.
# ---------------------------------------------------------------------------
working_text() {
  if [ "$turn_start" -le 0 ]; then
    echo 'Working'
    return
  fi
  elapsed=$((now - turn_start))
  if [ "$elapsed" -lt 60 ]; then
    echo 'Working'
    return
  fi
  mins=$((elapsed / 60))
  if [ "$mins" -ge 60 ]; then
    echo "Working $((mins / 60))h $((mins % 60))m"
  else
    echo "Working ${mins}m"
  fi
}

# ---------------------------------------------------------------------------
# Throttle — on the VALUE, not on the clock alone.
#
# A PreToolUse hook runs before every tool call and blocks it, and one cmux CLI
# invocation costs ~155ms on the machine this was built on (5 calls, 0.77s
# wall, cmux 0.64.22) [verified-by-execution, 2026-08-24]. Paying that on every
# tool use is minutes of pure latency across a long turn.
#
# So the call is skipped only when the value is IDENTICAL to the last one
# written AND that write is recent. A state CHANGE always goes through
# immediately — which is the load-bearing half: answering a permission prompt
# has to flip the pill back to "Working" on the very next tool call, not
# whenever the window happens to expire.
#
# The elapsed minute rides the same window: `Working` re-asserts at most every
# 10s, so the number turns over within 10s of the minute boundary. `prompt` is
# exempt because it RESETS the clock, and a stale `Working 9m` surviving into a
# fresh turn is the one wrong number worth a guaranteed cmux call.
#
# Backgrounding the call instead was considered and rejected: writes could then
# land out of order, and a stale "Working" overtaking "Waiting for you" is
# exactly the stuck pill this script exists to fix.
# ---------------------------------------------------------------------------
THROTTLE=10
if [ "$ARG" != prompt ] && [ "$last_state" = "$STATE" ] &&
  [ "$((now - last_at))" -lt "$THROTTLE" ]; then
  exit 0
fi

# Best-effort at every step: cmux being down, slow or newer than this script
# must never fail a hook, so every call swallows its status.
pill() { # $1 = text, $2 = SF Symbol, $3 = #hex
  CMUX_QUIET=1 cmux set-status task "$1" --icon "$2" --color "$3" \
    --priority 80 --workspace "$CMUX_WORKSPACE_ID" >/dev/null 2>&1 || true
}

lane() { # $1 = lane name, or `auto` to hand sorting back to cmux
  CMUX_QUIET=1 cmux workspace status set "$1" \
    --workspace "$CMUX_WORKSPACE_ID" >/dev/null 2>&1 || true
}

SKY='#38BDF8'
AMBER='#F59E0B'
SLATE='#94A3B8'

case "$STATE" in
  # `auto` and not a pinned `working`: the pill already says the agent is
  # moving, and pinning a lane on every tool call would override cmux's own
  # inference — which usefully shows `review` for a workspace with an open PR.
  # The lane's one job here is to float a workspace that WANTS the human.
  working)
    pill "$(working_text)" hammer.fill "$SKY"
    lane auto
    ;;
  # The two amber states mirror auto-review.sh's waiting state on purpose —
  # same bell, same amber. One visual language for "this workspace is blocked
  # on you", whoever wrote the pill; the text says which kind of blocked.
  blocked)
    pill 'Waiting for you' bell.fill "$AMBER"
    lane needs-attention
    ;;
  asked)
    pill 'Asked you a question' bell.fill "$AMBER"
    lane needs-attention
    ;;
  # Neutral, not green and not amber: the turn is over and the human is not
  # needed, but the work is not done either. Claiming "Finished" here would be
  # a lie of the same family as the bug this file fixes, because nothing
  # re-invokes the agent until the background task ends.
  background)
    pill 'Background work' gearshape.fill "$SLATE"
    lane auto
    ;;
  done)
    pill 'Finished' checkmark.circle.fill "$SLATE"
    lane auto
    ;;
  clear)
    CMUX_QUIET=1 cmux clear-status task \
      --workspace "$CMUX_WORKSPACE_ID" >/dev/null 2>&1 || true
    # Unpin too, or a session that ended while blocked leaves the workspace
    # pinned to needs-attention with no pill left to explain why.
    lane auto
    ;;
esac

# Written whether or not cmux accepted the calls. A cmux that is failing is
# retried on the next state change or once the window lapses — the same
# self-healing cadence as everything else here — rather than on every single
# tool call.
printf '%s %s %s\n' "$STATE" "$now" "$turn_start" >"$CACHE" 2>/dev/null || true
exit 0
