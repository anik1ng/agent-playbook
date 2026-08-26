# agy (Antigravity, Gemini family) as the reviewer

What ADOPT.md's "The reviewer" step renders when the human picks agy — the common pick
for repos whose PRs are authored by a Claude-family tool, since cross-family review is
the one hard rule. Flags below were read from `agy --help` on 1.1.11 (2026-08-10);
re-read `--help` before rendering, headless flags churn.

## The `{{REVIEW_CMD}}` shape

    agy -i "$REVIEW_PROMPT" \
      --model <the model the human chose> \
      --sandbox \
      --add-dir "$PWD"

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
first one is a misconfiguration, not the boundary working** — the allowlist below is
unseeded, the file grants point at the wrong directory, or `--add-dir` is missing from
the command. Adopting this into a repo that reviewed with per-PR worktrees leaves stale
`<repo>-wt-review-<n>` entries in `trustedWorkspaces`; delete them once the directories
are gone.

## The hook guard (the second boundary)

Copy both files as they are — no placeholders, nothing repo-specific:

    templates/agy/guard-reviewer.sh  →  .agents/guard-reviewer.sh   (chmod 755)
    templates/agy/hooks.json         →  .agents/hooks.json

The guard denies `git push`, `gh pr merge`, `gh pr close` and the `gh api` routes behind
them; everything else answers `{"decision":"ask"}` — agy's normal permission flow, not an
auto-allow. Two verified agy 1.1.11 behaviours the design rests on: a hook deny fires
even under a blanket permission bypass (the layer that survives a misconfigured
launcher), and a hook answering `{"decision":"allow"}` does NOT grant permission — a hook
can only deny or defer, never widen. Do not offer these files to a repo whose reviewer is
a different CLI: they are agy's hook format, and nothing else reads them.

## Seeding agy's allowlist — TWO grant forms, not one

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

Rules are prefixes (`git` matches `git add`, not `github`) and come in two
non-interchangeable forms:

| rule             | grants                         | the prompt it silences                        |
| ---------------- | ------------------------------ | --------------------------------------------- |
| `command(X)`     | running X at all               | "Do you want to proceed?"                     |
| `unsandboxed(X)` | running X OUTSIDE the sandbox  | "Allow sandbox bypass for command execution?" |

Anything touching the network or disk beyond the worktree — every `gh`, every
package-manager command, `git fetch`, a notify CLI — needs `unsandboxed(…)` TOO. Seeding
only `command(…)` looks fine on a local probe and floods the human on the first real
review. Seed both forms for the shapes a review needs (read-heavy, plus the few local
writes the protocol itself orders — verified against a live review, agy 1.1.20):
`git status|diff|log|show|rev-parse|rev-list|merge-base|ls-files|blame`,
`git branch --list`, `git worktree list`, `git checkout` (reverting mutations),
`git fetch`, `cd`, `gh pr view|diff|list|checks`, `gh issue view`, `gh pr comment` (the
verdict itself), the gate commands from AGENTS.md and the repo's own test runner
(`go test`, `pnpm test`, …), `rm -rf tmp` (scratch cleanup — matching stops at word
boundaries, so `rm -f tmp/` does NOT cover `rm -f tmp/a.txt` [seen live]: the protocol
deletes the whole scratch directory with this one exact command instead), `mkdir -p tmp`,
`sh -n`, `echo`, `pwd`, `rg`, `ls`, `wc`, `cat`, `head`, `tail` — and the read-only
diagnostics a session reaches for when its environment misbehaves, so a broken launcher
degrades into a handful of prompts instead of a stall: `grep`, `env`, `printenv`,
`type`, `which`, `git --version`, `git --exec-path`, `gh version`, `gh --version`.
(A pipe is checked per part like a `&&` chain — `env | grep GIT` needs BOTH `env` and
`grep` seeded, which is how `rg`-only lists still prompt.) Where the gate builds
artifacts, seed what handling them takes: `mkdir`, `touch`, and the exact
`rm -rf <artifact-dir>` the cleanup uses (`rm -rf .next`, …). Three shapes NO rule can
cover, so the protocol avoids them: a multi-line command (each heredoc line is checked
as a command of its own — write files with the editing tool), an output redirect
(`cmd > file` defeats the rule that covers `cmd` [seen live, three commands] — read
output directly), and a delete that lists files.
Deliberately NOT: bare `git branch` (the prefix also
matches `-D`), `git worktree` (…`remove`), `gh api` (POST hides behind the prefix),
`node` or any arbitrary-code runner — and no stream editor (`sed -i`, `perl -i`):
command rules carry no path scope, so that one entry is a silent write to ANY file on
disk. The review skill orders every edit through the file-editing tool instead, which
`write_file(<worktree>)` does scope. A `&&` chain cannot smuggle anything past the
list — verified: agy checks every part of the command line, not its first words.
