# SETUP.md — one-time GitHub configuration (the human's part)

`ADOPT.md` is for the agent; this page is for you. Do it once per repository, after
adoption, ~10 minutes. Order matters only for the ruleset (its status checks need one CI
run to exist first). Requires a plan with branch rulesets on private repos (GitHub Pro or
public repo).

Where a setting can be made from the terminal, the `gh` command is given — commands
survive GitHub UI redesigns; screenshots don't.

## 1. Merge settings — Settings → General → Pull Requests

Most of this the agent already offered via `gh api` during adoption; verify it stuck:

- Allow squash merging: **ON** — the only one enabled. Merge commits OFF, rebase OFF.
- Default commit message: **"Pull request title"** — the machine form of the rule "the PR
  title becomes the squash-commit title".
- Always suggest updating pull request branches: **ON** — surfaces a stale base, which is
  the thing the merge ritual ("never merge while Update branch is visible") watches.
- Allow auto-merge: **OFF** — the human merges deliberately, after hand-testing.
- Automatically delete head branches: **ON**.

```
gh api -X PATCH repos/{owner}/{repo} \
  -F allow_squash_merge=true -F allow_merge_commit=false \
  -F allow_rebase_merge=false -F delete_branch_on_merge=true \
  -F allow_auto_merge=false -F allow_update_branch=true \
  -F squash_merge_commit_title=PR_TITLE -F squash_merge_commit_message=BLANK
```

("Pull request title" in the UI = `PR_TITLE` + `BLANK`. Not "…and description": the PR
body is meta — test steps, Docs, Risk — and doesn't belong in git history. Not "…and
commit details": the branch's WIP commits are exactly what the squash exists to collapse.)

## 2. Branch ruleset — Settings → Rules → Rulesets → New branch ruleset

The one thing the pre-push hook cannot do: a PR that deletes a workflow doesn't go red —
its check just vanishes. A REQUIRED check cannot vanish; GitHub blocks the merge waiting
for it. This is what the paid plan buys.

Prefer a ruleset over a classic branch protection rule: rulesets apply to admins by
default, so the lock holds against you too.

Click-by-click on the "New branch ruleset" form:

1. Ruleset Name: `protect-default`.
2. Enforcement status: switch the dropdown from Disabled to **Active** (it ships
   Disabled — an Active-less ruleset enforces nothing).
3. Bypass list: leave **empty**. A lock you can step around is not a lock — and unlike
   classic branch protection, a ruleset with no bypass applies to you, the admin, too.
4. Target branches → Add target → **Include default branch**. (Not a name pattern — this
   survives a repo where the default is `master`, not `main`.)
5. Branch rules — check exactly these:
   - Restrict deletions ✓ (on by default)
   - Block force pushes ✓ (on by default)
   - Require a pull request before merging ✓ — in the sub-panel it reveals, set Required
     approvals: **0** (the independent reviewer posts a PR comment per the protocol; it
     is not a GitHub review), leave every review checkbox unchecked, and switch Allowed
     merge methods from "Merge, Squash, Rebase" to **Squash** — the General setting
     controls the buttons, this makes it law at the ruleset level too.
   - Require status checks to pass ✓ — in its sub-panel, tick **Require branches to be up
     to date before merging** (the machine form of the merge ritual; it takes effect once
     at least one check is added), leave "Do not require status checks on creation"
     unchecked, then add the required checks — see below.
   - Everything else stays OFF. In particular Automatically request Copilot code review:
     OFF — this workflow has its own reviewer protocol, and a second automatic reviewer
     adds noise the human then has to arbitrate.
6. Create.

**Required status checks**: the picker only offers names it has already seen, and GitHub
refuses to save the rule with an empty check list ("Required status checks cannot be
empty"). So on a fresh repo: leave "Require status checks to pass" UNCHECKED on the first
save, create the ruleset, and let the workflows run once on any PR — a throwaway one-word
PR you close unmerged is enough, checks register from the run itself. Then edit the
ruleset, re-enable the rule plus "Require branches to be up to date", and add — exactly
as the job names stand in your repo:

- `checks (…)` — the CI job (its name lists the steps that survived adoption)
- `PR body & title hygiene`
- `gitleaks (secret scan)`

**Why requiring `checks` is safe here.** `ci.yml` skips doc-only PRs by design, and a
workflow skipped by its path filter reports nothing — a required check that never reports
would block those PRs forever. That is what `ci-docs.yml` exists for: the no-op twin runs
on exactly the paths `ci.yml` ignores and reports success under the same job name
(GitHub's documented pattern for skipped-but-required checks). If you ever edit one
file's path list or job name, mirror it in the other — the comment in `ci-docs.yml` says
how.

## 3. Advanced Security — Settings → Advanced Security

- Dependency graph: **ON** (prerequisite for the rest).
- Dependabot alerts: **ON**, malware alerts: **ON**.
- Dependabot security updates: **ON** — CVE patches bypass the cooldowns in
  `dependabot.yml` by design: a known-exploited vulnerability outranks fresh-release risk.
- Grouped security updates: **ON**.
- Version updates — configured by the committed `.github/dependabot.yml`; nothing to
  click once that file is in the default branch.
- If the repo is **public**: also turn on Secret scanning and **Push protection** (free
  for public repos). gitleaks in CI stays — push protection blocks a leak before the
  commit even lands; the two overlap on purpose.

## 4. Actions — Settings → Actions → General

- Workflow permissions: **"Read repository contents and packages"** — the workflows that
  need more (gitleaks needs `pull-requests: read`) declare it themselves in their YAML.
- Allow GitHub Actions to create and approve pull requests: **OFF**.
- Run workflows from fork pull requests: **OFF**.
- Optional, in the spirit of the supply-chain policy: Actions permissions → "Allow
  {owner}, and select non-{owner} actions" with an allowlist like
  `actions/*, gitleaks/gitleaks-action@*` (extend it when a template adds an action — e.g.
  `oven-sh/setup-bun@*` on a bun repo). Do NOT require full-SHA pinning: the templates
  reference actions by major tag, and updating them is Dependabot's job, governed by the
  cooldowns.

## 5. Features — Settings → General → Features

- Issues: **ON** — the whole loop runs on them: `/do` reads them, every PR body
  links one, squash-merge closes it.
- Wikis: **OFF**. The whole documentation machinery here — the mandatory `## Docs`
  section, the reviewer's docs-honesty check, `docs/RUNBOOK.md` as the human's page —
  operates on files the diff can see, CI can gate, and the agent updates in the same PR.
  A wiki is a separate repository on the side: no diff, no gate, no reviewer. Keeping
  project docs there is doc drift by construction. Everything goes in `docs/`.

## 6. The rest (from the adoption summary, if not done yet)

- One-time secret sweep of history: a pass over `git log --all -p`; record the date in
  `.github/workflows/security.yml`.
- Confirm skill discovery in each agent tool you actually use (fresh session, make it
  LIST the skills — an agent asked whether it can see a skill says yes without looking).
- Package-manager cooldown (`minimumReleaseAge` + `trustLockfile` for pnpm) if the agent
  didn't set it during adoption.
