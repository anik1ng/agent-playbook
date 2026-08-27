#!/bin/sh
# PreToolUse guard for agy (Antigravity) sessions in this repo, wired via
# .agents/hooks.json. Two tiers of deny, one shared mechanic.
#
# TIER 1 — report-only. The three commands that would let the reviewer ACT on
# the PR — `git push`, `gh pr merge`, `gh pr close` — are denied at the tool
# layer, independently of whatever the launcher passes.
#
# TIER 2 — protocol enforcement. The command shapes the review skill forbids
# (SKILL.md "command discipline") are denied HERE, with the skill's reason in
# the denial, instead of falling through to an "ask" the human cannot judge.
# This exists because the human behind the prompt cannot evaluate a command
# without reading the code under review — which this pipeline is built to
# avoid — so an "ask" for an off-protocol command has only bad outcomes: a
# rubber-stamped yes (executes junk), or a bare no (stalls the session with
# no reason to act on). A deny that CARRIES the reason is the one answer that
# needs no human and keeps the session moving: the model reads why and takes
# the sanctioned path (cat instead of sed, a probe file instead of node -e,
# CI's check instead of a hand-started database). Every rule below maps to a
# live stall from a real auto-review run.
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
# denial rather than as abstention, which is why the fallthrough is explicit.
#
# This is a TRIPWIRE, not a sandbox: a regex over the rendered command string
# stops the reviewer from running these commands in the way it plausibly would,
# and cannot stop deliberate evasion (obfuscated indirection, a script that
# shells out). The boundary against an adversarially-steered reviewer is the
# sandbox flag the launcher passes. A positive allowlist is not viable here
# because the review protocol requires running arbitrary probe tests.
# Tier-2 corollary: the payload can carry prose (context, the model's own
# reasoning) alongside the command, so a rule may occasionally deny a
# legitimate line whose prose QUOTES a forbidden shape. That failure is
# self-healing — the model rewords and retries — and it is the accepted price
# for the prompts these rules retire; a rule that misfires persistently gets
# narrowed, not the tier removed.
#
# The `gh api` pattern covers the REST routes behind the two `gh pr` commands
# (`…/pulls/N/merge`, and `-f state=closed` for a close).
#
# Every pattern must sit at a COMMAND POSITION — the start of the payload, a
# quote, or a shell operator (`&& | ; ( {`), optional whitespace after it.
# This is what separates a command from PROSE, without parsing the payload:
# the hook is handed a JSON blob whose shape is the CLI's business and can
# carry more than the command line — context, a file it just read, the
# model's own reasoning. Matching the blob as flat text made
# `node scripts/setup-worktree.mts` deny because a sentence nearby said the
# reviewer must never `git push` (an adopted repo, live: the identical command
# answered deny once and ask a minute later, the only difference being what
# else rode along). A tripwire that fires on the word teaches the session to
# reword its command until it passes, which is worse than not having one.
# `never git push` in prose is preceded by a word, so it no longer fires;
# `npm test && git push` is preceded by an operator, so it still does.
#
# The git pattern tolerates OPTIONS BETWEEN `git` and `push`, including the
# ones that take a separate argument — `git -C <dir> push`, `git -c k=v push`.
# It used to allow only single-token flags, so the argument after `-C` broke
# the chain and the commonest rewrite of a blocked command walked straight
# through the tripwire (found by one adopted repo's sync, verified here). Options
# only: a bare word after `git` ends the match, which is what keeps
# `git log --grep=push` an ordinary read.
#
# Do NOT add a per-ask notification here unless agy's allowlist is NARROW:
# against a broad allow (command(*)/unsandboxed(*)) nothing ever stalls, and a
# notify per tool call announces prompts that never come — once per command,
# for the whole review (a live incident). The announcement and a narrow
# allowlist are a matched pair: wire both or neither, and any such line must
# be best-effort, never changing the decision or the exit status.

payload=$(cat)

# A command position: start of payload, a quote/backtick, a shell operator, or
# an escaped newline inside the JSON string — optional whitespace after it.
A='(^|["'"'"'`&|;({]|\\n)[[:space:]]*'

hit() { printf '%s' "$payload" | grep -qE "$1"; }
deny() { printf '{"decision":"deny","reason":"%s"}' "$1"; exit 0; }

# --- Tier 1: report-only (unchanged) ---------------------------------------
if hit "$A(git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]-][^[:space:]]*)?)*[[:space:]]+push|gh[[:space:]]+pr[[:space:]]+(merge|close)|gh[[:space:]]+api[^|;&]*(merge|state=closed))"; then
  deny "Reviewer sessions are report-only: git push / gh pr merge / gh pr close are blocked by .agents/hooks.json (AGENTS.md, Reviewer protocol)."
fi

# --- Tier 2: protocol enforcement (SKILL.md command discipline) ------------
# Stream editors, even read-only: sed's flags reorder freely, so no allowlist
# entry can cover the read form without also covering an in-place write.
if hit "$A(sed|awk|perl)[[:space:]]"; then
  deny "Off-protocol: stream editors are unseedable. Read files with cat/head/tail or the file-reading tool; edit only with the file-editing tool (review SKILL.md, command discipline)."
fi

# export prefixes: an env write rewrites what every later seeded command means.
if hit "${A}export[[:space:]]+[A-Za-z_][A-Za-z0-9_]*="; then
  deny "Off-protocol: never set env vars in shell commands. A suite that skips without its env skips by design - CI owns that suite; read its check on the PR (review SKILL.md, command discipline)."
fi

# Services and containers: the reviewer never starts infrastructure.
if hit "${A}docker[[:space:]]"; then
  deny "Off-protocol: never start services or containers. CI owns integration infrastructure - read its check on the PR instead of rebuilding the environment (review SKILL.md, command discipline)."
fi

# Inline eval: arbitrary code outside the repo's own test layout.
if hit "${A}node[[:space:]]+(-e|--eval)([[:space:]]|['\"])"; then
  deny "Off-protocol: no inline eval. Write a throwaway probe test with the file-editing tool and run it through the repo's seeded test runner (review SKILL.md, command discipline)."
fi

# Bare npx: an arbitrary-code runner. The one seeded form is `npx vitest run`.
if hit "${A}npx[[:space:]]" && ! hit "${A}npx[[:space:]]+vitest[[:space:]]+run"; then
  deny "Off-protocol: bare npx is an arbitrary-code runner. Use the repo's own scripts; the one seeded npx form is 'npx vitest run <file>' (review SKILL.md, command discipline)."
fi

# gh output redirected to a file: a redirect defeats allowlist matching.
if hit "${A}gh[[:space:]][^|;&<>]*>{1,2}[[:space:]]*[A-Za-z0-9_./~-]"; then
  deny "Off-protocol: never redirect output to a file - a redirect defeats the allowlist rule that covers the command. Re-run without '> file' and read the output directly (review SKILL.md, command discipline)."
fi

printf '{"decision":"ask"}'
