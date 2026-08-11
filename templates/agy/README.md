# agy (Antigravity, Gemini family) as the reviewer

What ADOPT.md's "The reviewer" step renders when the human picks agy — the common pick
for repos whose PRs are authored by a Claude-family tool, since cross-family review is
the one hard rule. Flags below were read from `agy --help` on 1.1.11 (2026-08-10);
re-read `--help` before rendering, headless flags churn.

## The `{{REVIEW_CMD}}` shape

    agy -i "Read .agents/skills/review/SKILL.md in this repository and follow it \
    exactly to review pull request #$PR. Post the verdict as a comment on that PR — a \
    verdict that stayed in your transcript did not happen." \
      --model <the model the human chose> \
      --sandbox

`--sandbox` is the reach boundary — never replace it with a blanket
`--dangerously-skip-permissions`. `--model` is explicit on purpose: a default that flips
to the author's family silently breaks cross-family review. `-i` is interactive, which is
correct because `auto-review.sh` runs the session on a visible cmux terminal.

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
file: ask before writing it and leave a timestamped `.bak`. Rules are prefixes (`git`
matches `git add`, not `github`) and come in two non-interchangeable forms:

| rule             | grants                         | the prompt it silences                        |
| ---------------- | ------------------------------ | --------------------------------------------- |
| `command(X)`     | running X at all               | "Do you want to proceed?"                     |
| `unsandboxed(X)` | running X OUTSIDE the sandbox  | "Allow sandbox bypass for command execution?" |

Anything touching the network or disk beyond the worktree — every `gh`, every
package-manager command, `git fetch`, a notify CLI — needs `unsandboxed(…)` TOO. Seeding
only `command(…)` looks fine on a local probe and floods the human on the first real
review. Seed both forms for the read-only shapes a review needs:
`git status|diff|log|show|rev-parse|ls-files|blame`, `git branch --list`,
`git worktree list`, `gh pr view|diff|list|checks`, `gh issue view`, `gh pr comment` (the
verdict itself), the gate commands from AGENTS.md, `git fetch`, `git rev-list`, `sh -n`,
`echo`, `rg`, `ls`, `wc`. Deliberately NOT: bare `git branch` (the prefix also matches
`-D`), `git worktree` (…`remove`), `gh api` (POST hides behind the prefix), `node` or any
arbitrary-code runner. A `&&` chain cannot smuggle anything past the list — verified: agy
checks every part of the command line, not its first words.
