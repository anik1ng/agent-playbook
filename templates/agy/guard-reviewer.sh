#!/bin/sh
# PreToolUse guard for agy (Antigravity) sessions in this repo, wired via
# .agents/hooks.json. The reviewer is report-only, so the three commands that
# would let it ACT on the PR — `git push`, `gh pr merge`, `gh pr close` — are
# denied at the tool layer, independently of whatever the launcher passes.
#
# This is ADOPT.md's SECOND boundary. The first is the CLI's own permission
# config; this one survives the first being misconfigured: verified on agy
# 1.1.11 (2026-08-10), a deny from this hook fires even under a blanket
# permission bypass, while a hook answering {"decision":"allow"} does NOT grant
# permission — so a hook can only deny or defer, never widen.
#
# Contract (agy's hooks.md): stdin carries the tool call as JSON; stdout must
# return a decision. Non-matching commands answer {"decision":"ask"} — agy's
# normal permission flow, NOT an auto-allow. An empty object {} is treated as a
# denial rather than as abstention, which is why the else branch is explicit.
#
# This is a TRIPWIRE, not a sandbox: a regex over the rendered command string
# stops the reviewer from running these commands in the way it plausibly would,
# and cannot stop deliberate evasion (obfuscated indirection, a script that
# shells out). The boundary against an adversarially-steered reviewer is the
# sandbox flag the launcher passes. A positive allowlist is not viable here
# because the review protocol requires running arbitrary probe tests.
#
# The `gh api` pattern covers the REST routes behind the two `gh pr` commands
# (`…/pulls/N/merge`, and `-f state=closed` for a close).
#
# The git pattern tolerates OPTIONS BETWEEN `git` and `push`, including the
# ones that take a separate argument — `git -C <dir> push`, `git -c k=v push`.
# It used to allow only single-token flags, so the argument after `-C` broke
# the chain and the commonest rewrite of a blocked command walked straight
# through the tripwire (found by seejs.app's sync, verified here). Options
# only: a bare word after `git` ends the match, which is what keeps
# `git log --grep=push` an ordinary read.
#
# Do NOT add a per-ask notification here unless agy's allowlist is NARROW:
# against a broad allow (command(*)/unsandboxed(*)) nothing ever stalls, and a
# notify per tool call announces prompts that never come — once per command,
# for the whole review (nsarchive#129). The announcement and a narrow
# allowlist are a matched pair: wire both or neither, and any such line must
# be best-effort, never changing the decision or the exit status.

payload=$(cat)

if printf '%s' "$payload" | grep -qE '(^|[^[:alnum:]_.-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]-][^[:space:]]*)?)*[[:space:]]+push|(^|[^[:alnum:]_.-])gh[[:space:]]+pr[[:space:]]+(merge|close)|(^|[^[:alnum:]_.-])gh[[:space:]]+api[^|;&]*(merge|state=closed)'; then
  printf '{"decision":"deny","reason":"Reviewer sessions are report-only: git push / gh pr merge / gh pr close are blocked by .agents/hooks.json (AGENTS.md, Reviewer protocol)."}'
else
  printf '{"decision":"ask"}'
fi
