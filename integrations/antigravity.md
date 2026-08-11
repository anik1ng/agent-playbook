# agy (Antigravity) — reviewer CLI integration

agy is Google's Antigravity CLI (Gemini family). This page is what to do when the human
picks it as the **reviewer** in ADOPT.md's "Reviewer CLI" step — the common case for repos
whose PRs are authored by a Claude- or GPT-family tool, since cross-family review is that
step's one hard rule.

Everything here is optional and per-socket, and every socket ends in a question. Detection
never implies consent.

## Detect

    command -v agy && agy --version

Report the version you found. The flags below were read from `agy --help` on **1.1.11
(2026-08-10)** and headless flags churn — re-read `--help` before rendering anything, as
ADOPT.md already requires.

## Socket 1 — `{{REVIEW_CMD}}` in `.agents/auto-review.sh`

agy's review invocation, with the three things ADOPT.md demands (explicit model, scoped
reach, no blanket bypass):

    agy -i "Read .agents/skills/review/SKILL.md in this repository and follow it \
    exactly to review pull request #$PR. Post the verdict as a comment on that PR — a \
    verdict that stayed in your transcript did not happen." \
      --model <the model the human chose> \
      --sandbox \
      --add-dir "$(git rev-parse --show-toplevel)"

- `--sandbox` is the REACH boundary. Keep it. The blanket
  `--dangerously-skip-permissions` flag is the thing this integration exists to avoid: it
  does not widen the toolset, it dissolves the boundary around the repo.
- `--model` is named explicitly on purpose — a default that flips to the author's family
  silently breaks cross-family review, and nothing else in the pipeline would notice.
- `-i` is interactive. That is correct ONLY where a human terminal exists — pair this
  socket with `integrations/cmux.md` socket 2 (the workspace render base). For a headless
  repo, render agy's non-interactive form instead and seed permissions wide enough that
  nothing asks, per ADOPT.md.

## Socket 2 — the hook-layer guard (ADOPT.md's second boundary)

agy has a hooks mechanism, so it gets the second, independent guard. Two files, copied as
they are:

| Template                            | Destination                 |
| ----------------------------------- | --------------------------- |
| `templates/agy/guard-reviewer.sh`   | `.agents/guard-reviewer.sh` |
| `templates/agy/hooks.json`          | `.agents/hooks.json`        |

    chmod +x .agents/guard-reviewer.sh

No placeholders — nothing in either file is repo-specific. The guard denies `git push`,
`gh pr merge`, `gh pr close` and the `gh api` routes behind the last two; everything else
answers `{"decision":"ask"}`, which is agy's normal permission flow rather than an
auto-allow.

Two behaviours worth knowing before you rely on this, both verified on agy 1.1.11:

- a hook deny **fires even under a blanket permission bypass** — which is what makes this
  the layer that survives a misconfigured launcher;
- a hook answering `{"decision":"allow"}` does **not** grant permission, and an empty `{}`
  is read as a denial. A hook can therefore only deny or defer. Do not try to build an
  auto-approver out of it.

## Socket 3 — seeding agy's own allowlist, in TWO forms

Under `--sandbox` every tool call the guard does not deny becomes a prompt, and a review is
mostly `gh` plus the gate — so an unseeded allowlist floods the human on the first real
review. agy's `permissions.allow` lives in `~/.gemini/antigravity-cli/settings.json` (a
per-MACHINE file, not per-repo: it is the human's to edit, so ask before writing it, and
leave a timestamped `.bak` beside it) and uses prefix rules — agy's own note: "`git`
matches `git add` but NOT `github`". The rules come in two forms that are NOT
interchangeable:

| rule            | grants                        | the prompt it silences                          |
| --------------- | ----------------------------- | ----------------------------------------------- |
| `command(X)`    | running X at all              | "Do you want to proceed?"                       |
| `unsandboxed(X)`| running X OUTSIDE the sandbox | "Allow sandbox bypass for command execution?"    |

Anything that touches the network or the disk beyond the worktree — **every `gh`, every
package-manager command, `git fetch`, a notify CLI** — needs the `unsandboxed(…)` form as
well. Seeding only `command(…)` looks fine on a local probe like `git diff` and then floods
the human the moment a real review starts.

Seed both forms for the read-only shapes a review needs: `git
status|diff|log|show|rev-parse|ls-files|blame`, `git branch --list`, `git worktree list`,
`gh pr view|diff|list|checks`, `gh issue view`, `gh pr comment` (the verdict itself), the
gate commands from AGENTS.md, `git fetch`, `git rev-list`, `sh -n`, `echo`, `rg`, `ls`,
`wc`. Deliberately NOT allowed: bare `git branch` (that prefix also matches `git branch
-D`), `git worktree` (…`remove`), `gh api` (POST hides behind the same prefix), and `node`
or any other arbitrary-code runner.

`echo` has to be listed explicitly because it is the glue in almost every chain a reviewer
writes — and a chain cannot smuggle anything past the allowlist: verified both ways, `git
status && git diff` (both allowed) runs, while `git status && echo …` was DENIED while
`echo` was not on the list. agy checks every part of the command line, not its first words.

## What the human loses without agy

Nothing in the workflow breaks — the `review` skill is vendor-neutral and any CLI can
follow it. What they lose is the cheapest available *different family*: with a
Claude-family author, an agy reviewer satisfies AGENTS.md "Model routing" without spending
the author's quota. If they decline agy, ADOPT.md's question stands unchanged: pick another
family, or run `/review` by hand from a fresh session.

## When agy disappears later

`.agents/auto-review.sh` fails at launch (it runs a command that no longer exists) and the
`auto-review` status goes red — loud, per launch, which is the contract. The two guard
files become inert: `.agents/hooks.json` is agy's format and nothing else reads it. Leave
them or delete them together; re-render `{{REVIEW_CMD}}` for whatever CLI replaces it, and
re-run ADOPT.md's live probes.
