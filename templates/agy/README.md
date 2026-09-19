# agy (Antigravity, Gemini family) as the reviewer

What ADOPT.md's "The reviewer" step renders when the human picks agy — the common pick
for repos whose PRs are authored by a Claude-family tool, since cross-family review is
the one hard rule. Flags below were read from `agy --help` on 1.1.11 (2026-08-10);
re-read `--help` before rendering, headless flags churn.

## The `{{REVIEW_CMD}}` shape

    agy -i "$REVIEW_PROMPT" \
      --model gemini-3.8-flash-high \
      --sandbox \
      --add-dir "$PWD"

**The model is the playbook's current pick, and a sync carries it** (UPDATE.md's
`auto-review.sh` paragraph): `gemini-3.8-flash-high`, chosen 2026-09-19 over
`gemini-3.1-pro-high` on two replayed reviews with a known answer, in adopted repos
[verified-by-execution]. On a head where Pro had found one real blocker by mutation,
Flash found the same one by mutation and a SECOND real one Pro had missed (a helper
whose only test was positive, so `() => true` passed the suite), ran the full gate
including the archive smoke suite, and hallucinated nothing; on a head where Pro had
raised a false blocker (it predicted parallel-test breakage without reading the runner
config that disables parallelism), Flash approved and named two real minors Pro had
missed. Its one downgrade: an untested `OR` branch Pro called a blocker, Flash a minor.
Two runs is a small sample; the verdict comment names the model, so the record stays
auditable and the line reverts in one edit. Re-measure the same way before changing
it again — never on a vendor's benchmark table or a model's account of itself.

The prompt is NOT written into this line: `auto-review.sh` exports `$REVIEW_PROMPT`,
carrying the worktree's absolute path and the order to never leave it. That is what stops
a session that lost its workspace from hunting for the repo across the human's home
directory — one permission prompt per read (a live failure, an adopted repo's PR review).
Owning the prompt in the script also means prompt fixes reach every repo through an
ordinary sync; this line owns only the CLI, the model and the flags.

`--sandbox` is the reach boundary — never replace it with a blanket
`--dangerously-skip-permissions`. `--model` is explicit on purpose: a default that flips
to the author's family silently breaks cross-family review. `-i` is interactive, which is
correct because `auto-review.sh` runs the session on a visible cmux terminal.
`--add-dir "$PWD"` names the worktree an allowed directory so reads inside it don't
prompt — flags churn, re-read `--help` before rendering.

**Expect ONE question, once — not one per PR**: Antigravity trusts a FOLDER, and every
review of this repository runs in the SAME worktree (`<repo>-wt-review`), so "Do you
trust the contents of this project?" is answered on the first review and never again.
`auto-review.sh` keeps one worktree per repository for exactly this reason; a per-PR
path put that dialog in front of the human on every single PR. **Any prompt after that
first one is one of exactly two findings.** Either a misconfiguration — the allowlist
below is unseeded, the file grants point at the wrong directory, or `--add-dir` is
missing from the command — or the reviewer stepping OUTSIDE the shapes the review
skill orders it to stay in: a redirect, a stream editor, an `export …` prefix, a
hand-started container (all seen live, with the current skill loaded). The second is
the boundary HOLDING — and `guard-reviewer.sh`'s tier 2 now answers most of those
itself, with a deny that carries the reason, so the session self-corrects instead of
stalling on a human. The fix for a recurring one lives in the skill's
command-discipline rules and the guard's tier-2 patterns, never in a wider allowlist —
what the reviewer reached for is unseeded on purpose.
Adopting this into a repo that reviewed with per-PR worktrees leaves stale
`<repo>-wt-review-<n>` entries in `trustedWorkspaces`; delete them once the directories
are gone.

## The hook guard (the second boundary)

Copy both files as they are — no placeholders, nothing repo-specific:

    templates/agy/guard-reviewer.sh  →  .agents/guard-reviewer.sh   (chmod 755)
    templates/agy/hooks.json         →  .agents/hooks.json

Two tiers, one mechanic. Tier 1 denies `git push`, `gh pr merge`, `gh pr close` and
the `gh api` routes behind them — the reviewer is report-only. Tier 2 denies the
command shapes the review skill forbids (stream editors, `export` prefixes, `$(…)`
substitution, `xargs`, docker, inline eval, bare `npx`, any file written through the
shell — heredoc, redirect, tee — `mv`/`cp`/`ln`, `rm` in any form but
`rm -rf <one directory>`, package installs, and `gh api`), each with a one-line reason
naming the sanctioned alternative — because an "ask" for an
off-protocol command reaches a human who cannot judge it without reading the code
under review, which this pipeline is built to avoid. A deny that carries the reason
needs no human and the session self-corrects. Everything else answers
`{"decision":"ask"}` — agy's normal permission flow, not an auto-allow. Two verified
agy 1.1.11 behaviours the design rests on: a hook deny fires even under a blanket
permission bypass (the layer that survives a misconfigured launcher), and a hook
answering `{"decision":"allow"}` does NOT grant permission — a hook can only deny or
defer, never widen. Do not offer these files to a repo whose reviewer is a different
CLI: they are agy's hook format, and nothing else reads them.

The payload the hook reads is JSON from a Go encoder, and Go escapes the HTML-sensitive
characters: `>` arrives as backslash-u003e, `<` as backslash-u003c, `&` as
backslash-u0026 (spelled in words here: an API commit through a client that decodes
JSON escapes turns the literal sequence into the bare character). The hooks page
does not say so — its example is `npm test` — and it was found by execution on agy
1.2.1, after the redirect rule had been "in place" for weeks without firing once:
`gh pr diff N > tmp/diff.patch` prompted the human every time, and `… && git push` would
have walked past tier 1. The guard folds the three escapes back before matching. Any new
pattern that names one of those characters is tested against the ESCAPED form, not the
shell string — the way to see the real payload is a hook that appends its stdin to a
file inside the worktree.

## Seeding agy's allowlist — ONE grant form since agy 1.2.2

`permissions.allow` lives in `~/.gemini/antigravity-cli/settings.json` — a per-MACHINE
file: ask before writing it and leave a timestamped `.bak`.

**Enumerate. Never `command(*)`.** A wildcard allow reads like the fast way to stop the
prompting, and it silently demotes the deny list from "second layer" to "only layer" —
which a prefix deny list cannot carry. It is a list of three command shapes: `gh api`
is not one of them, and its REST route merges a PR; nor is an argument-reordered
`git -C <dir> push`, which does not start with `git push`. one adopted repo was adopted with
`command(*)` + `unsandboxed(*)` and read as correctly configured for six PRs. The
enumerated list below is the whole point of this section.

The file grants are the other half, and they name the REVIEWER's worktree —
`read_file(<repo-parent>/<repo>-wt-review)`, and `write_file` on the same path because
probe tests and the gate write there. **Not the main checkout**: it holds the author's
uncommitted work, which is the one tree the reviewer must never touch, and it is not
where the reviewer runs anyway (one adopted repo granted exactly that, so every read inside the
review worktree asked, and a write to the author's copy would not have).

Two more grants per repository, for git itself. A worktree keeps its repository OUTSIDE
its own directory (`.git` is a one-line pointer into the main checkout's
`.git/worktrees/<name>`), and the sandbox mounts nothing it was not granted — so inside
it every git command failed with `fatal: not a git repository`, the reviewer spent its
first minutes diagnosing the sandbox, and every git read ran on the unsandboxed retry
(seen live, at the start of every review). Grant the main checkout's `.git` read-only
and the worktree's own git directory read-write, and `git status` answers inside the
sandbox (verified on agy 1.2.1):

    read_file(<repo-parent>/<repo>/.git)
    write_file(<repo-parent>/<repo>/.git/worktrees/<repo>-wt-review)

Read-only on the main `.git` is the point: refs and objects are readable, the author's
branches are not writable. The one remaining noise, git's fsmonitor daemon answering
over a unix socket the sandbox does not pass, `auto-review.sh` silences with
per-worktree config (`core.fsmonitor false`), so no `error:` line tempts the reviewer
into diagnostics.

Rules are prefixes (`git` matches `git add`, not `github`), and agy 1.2.x also
accepts `command(regex:…)` — a regex rule can name an exact shape a prefix cannot,
which is the only reason to reach for one; a regex that widens is `command(*)` in more
characters. The list below stays enumerated prefixes.

**There is ONE form, `command(X)`, and it covers both prompts** — "Do you want to
proceed?" and "Allow sandbox bypass for command execution?". Until 1.2.1 those were two
non-interchangeable rules, `command(X)` and `unsandboxed(X)`, and this section seeded
both; agy 1.2.2 dropped the second form with no documentation and a startup warning
("Invalid `unsandboxed` permission rules found; they are ignored and grant nothing …
replace `unsandboxed` with `command`"). Verified on 1.2.7 [verified-by-execution]: a
`gh pr view` that ran with the sandbox bypass was admitted by `command(gh pr view)`
alone, no prompt, with every `unsandboxed(…)` entry deleted. **A file seeded under the
old rule migrates by deletion**: every `unsandboxed(X)` has a `command(X)` twin, so
drop the `unsandboxed(` entries from `allow` AND `deny` (the deny trio has its
`command(…)` twins too) and keep the `.bak`; an entry with no twin is renamed, not
dropped. Leaving them in costs nothing but the warning, since they grant nothing.

The sandbox is still the boundary, only the grant changed. Anything touching the
network or disk beyond the worktree — every `gh`, every package-manager command,
`git fetch`, a notify CLI — runs OUTSIDE the sandbox, with the bypass, and the
reviewer has to ask for the bypass itself: the sandbox has no network, and on a
machine whose Node is version-managed (fnm's multishell directory, a `~/Library/pnpm`
home) it has no test runner either — inside it `pnpm` answers
`operation not permitted` and `which pnpm` finds nothing [seen live]. A reviewer that
meets that and falls back to "CI is green" has not run the gate; the review skill says
so in as many words now. Seed the shapes a review needs (read-heavy, plus the few local
writes the protocol itself orders — verified against a live review, agy 1.1.20):
`git status|diff|log|show|rev-parse|rev-list|merge-base|ls-files|blame`,
`git branch --list`, `git worktree list`, `git checkout` (reverting mutations),
`git fetch`, `cd`, `gh pr view|diff|list|checks`, `gh issue view`, `gh pr comment` (the
verdict itself), `gh ruleset check|list` (the gate-integrity item's ruleset read — it
used to prescribe `gh api … /rulesets`, and `gh api` is unseeded below on purpose, so
that one line stalled every review that reached it [seen live]), the gate commands from
AGENTS.md and the repo's own test runner
(`go test`, `pnpm test`, …) — including every per-language gate delegator the root
manifest exposes (`npm run go:test`, `npm run go:vet`, …: a reviewer legitimately
re-runs one half of a two-language gate, and the un-seeded half prompts [seen live]) —
and, where vitest is the runner, `npx vitest run` AND `pnpm vitest run`: the targeted
single-file form the probe workflow needs, running the same committed test files
`pnpm test` already runs, while the three-word prefix cannot launch any other package
(bare `npx` stays out below). Seed both spellings: in a pnpm repo the reviewer reaches
for `pnpm vitest run`, and with only the `npx` form seeded that one command prompted
five times in one review [seen live] — a one-shot "yes" covers one invocation, not the
shape. `rm -rf tmp` (scratch cleanup — matching stops at word boundaries, so
`rm -f tmp/` does NOT cover `rm -f tmp/a.txt` [seen live]: the protocol deletes the
whole scratch directory with this one exact command instead), `mkdir -p tmp`,
`sh -n`, `sh tmp/probe.sh` (the ONE seeded way to run a shell-script probe — the skill
pins the harness to that exact path because a bare `sh` entry would run any script
anywhere on disk [seen live: a guard-script review stalled on `sh tmp/test.sh`]),
`echo`, `pwd`, `rg`, `ls`, `wc`, `cat`, `head`, `tail` — and the read-only
diagnostics a session reaches for when its environment misbehaves, so a broken launcher
degrades into a handful of prompts instead of a stall: `grep`, `env`, `printenv`,
`type`, `which`, `git --version`, `git --exec-path`, `gh version`, `gh --version`.
(A pipe is checked per part like a `&&` chain — `env | grep GIT` needs BOTH `env` and
`grep` seeded, which is how `rg`-only lists still prompt.) Where the gate builds
artifacts, seed what handling them takes: `mkdir`, `touch`, and the exact
`rm -rf <artifact-dir>` the cleanup uses (`rm -rf .next`, …). Three shapes NO rule can
cover, so the protocol avoids them: a multi-line command (each heredoc line is checked
as a command of its own — write files with the editing tool), an output redirect
(`cmd > file` defeats the rule that covers `cmd` [seen live, four commands — the fourth
a `git diff … > tmp/diff.patch`, which the guard then covered only for `gh`] — read
output directly), and a delete that lists files.
Deliberately NOT: bare `git branch` (the prefix also
matches `-D`), `git worktree` (…`remove`), `gh api` (POST hides behind the prefix),
`node`, bare `npx` or any arbitrary-code runner; `export` (an env write rewrites what
every later seeded command means — a prepended `PATH` turns a seeded `git status` into
any binary on disk, so the entry would silently widen every other rule in the list);
`docker` (`run` starts a service and `-v` mounts any path on the machine — a reviewer
has no business starting infrastructure, and the review skill now says so outright);
and no stream editor (`sed`, `perl -i`, `awk`) even for READS:
command rules carry no path scope and sed's flags reorder freely, so even the narrow
`sed -n` entry still covers `sed -n -i s/…/…/ <file>` — a silent write to ANY file on
disk. The review skill orders every edit through
the file-editing tool instead, which `write_file(<worktree>)` does scope, and every
read through that tool or `cat`/`head`/`tail`. A `&&` chain cannot smuggle anything past the
list — verified: agy checks every part of the command line, not its first words.
Tier 2 of `guard-reviewer.sh` is the enforcement half of this paragraph: the shapes
listed as deliberately unseeded are auto-denied there with the reason, so they cost
the reviewer a self-correction instead of costing the human a prompt.
