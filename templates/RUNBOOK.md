# RUNBOOK — the human's page

<!-- Customize: nothing in this preamble — it is what makes agents keep the page current. -->

Everything YOU run, click, or must remember to operate this project day to day. Agents keep
this file current: any PR that adds something human-facing (a script, a page, an env var, a
ritual) must update it — the PR template's Docs section and the reviewer's docs-honesty item
enforce that. If you catch yourself remembering something this page doesn't say, that's a bug
in this page — file it.

---

## Daily development

<!-- Customize: add the commands you actually type; delete the lines that don't apply. -->

- **Starting a task**: type `/do <n>` in the agent session — that replaces the whole
  typed preamble. It reads `AGENTS.md` and issue #n **including its comments** (spec
  amendments live there), then decides what the issue needs next: a substantial issue with
  no spec turns the session into a brainstorm that writes the spec and the plan (`AGENTS.md`
  "Specs and plans") and stops; otherwise it gets onto the right branch, implements, and
  ships the PR. Filing a two-line reminder issue is fine — `/do` grows it when its turn
  comes. `/ship` on its own re-runs just the tail — rebase, gate, push, PR — on a branch
  whose work is already done and committed.
- **Where those three live**: `.agents/skills/{do,ship,review}/SKILL.md`, in this
  repo. They are ordinary files — edit them when a rule of yours changes, same as any doc.
  `.claude/skills/*` are symlinks to them, because Claude Code doesn't read `.agents/`. Every
  other agent tool reads `.agents/` directly, which is the point: the reviewer is supposed to
  be a different model family than the author, so the protocol can't live in one vendor's
  plugin.
- **Checking the wiring still holds**: ask any agent session to run the "Verify the
  installation" checklist at the end of `ADOPT.md` in the playbook repository. It re-verifies
  what adoption set up — the skill symlinks resolve, no placeholder survived, `core.hooksPath`
  points at `.githooks`, the hook actually refuses a push to the default branch, merges are
  squash-only. Worth a run after every fresh clone and every new worktree: `core.hooksPath` is
  a per-clone setting that is never committed, so a new clone starts with the pre-push lock
  disarmed and nothing says so.
- **Dev servers**: only you start/stop them. Agents never do — if a server is behaving oddly,
  restart it yourself after a merge.
- **The local gate** (what CI will run anyway):

      {{PKG_MANAGER}} run type-check && {{PKG_MANAGER}} run lint && {{TEST_CMD}}

## Database

<!-- Customize: DELETE this section if the project has no database. -->

- One shared dev DB; the one-schema-branch-at-a-time rule and who may apply it live in
  `AGENTS.md` — that section is the law, this is the recap.
- Rebuild the dev DB from schema when it's wedged: _(add the command)_ — destructive to dev
  data, which is disposable by design.
- After a schema PR merges: rebuild the dev DB from the default branch before the next schema
  task starts.

## Dependency cooldowns (supply chain)

<!-- Customize: add the local half (your package manager's minimum-release-age setting) once you enable it. -->

Nothing may enter this repo until its release has been public for a few days. Nearly every
malicious npm release is caught and pulled within 24–72h, so the wait skips that window.
The policy is **3 days for minor/patch, 14 days for majors**, and it belongs in two places
because neither half can do the other's job:

| Layer                     | Where                    | What it gates                                   |
| ------------------------- | ------------------------ | ----------------------------------------------- |
| Dependabot `cooldown:`    | `.github/dependabot.yml` | when a bump PR is even **opened** (server-side) |
| Package-manager min-age   | your package manager     | what **any local install** may resolve to       |

- **Security updates bypass the Dependabot cooldown by design** — a known-exploited CVE
  outranks a fresh-release risk. Confirm they're on: repo **Settings → Advanced Security →
  Dependabot security updates**. Only you can see or toggle that checkbox; no PR can.
- A local min-age setting gates **resolution, not installation**: make sure an
  already-committed lockfile still installs as-is, or `--frozen-lockfile` in CI breaks every
  time a security patch lands younger than the cooldown — exactly backwards for the update
  class that should move fastest.
- If you need a package published today, add that exact version to your package manager's
  exclude list, install, then drop the line in the same PR — with a comment naming the CVE.
  An exclude with no removal date in its comment is a bug.

## CI shape (what runs, and what it bills)

<!-- Customize: the timings and the job list, once you've watched a few real runs. -->

- Three workflows, one job each: **CI** (`checks` — type-check, lint, build, tests), **PR
  hygiene** (body + title greps) and **Security** (gitleaks). Build is a STEP inside `checks`,
  not a job of its own: GitHub bills per job rounded up to the minute, so a second runner
  costs ~2 billed minutes for ~40s of work.
- **A doc-only PR runs no real CI, on purpose.** `ci.yml` ignores `docs/**`, `**.md`
  (anywhere, root included) and the agent-config directories; `ci-docs.yml` — its no-op
  twin — reports the green `checks` for exactly those PRs, so a required status check
  never hangs on them. Expected and mergeable.
- **Security runs on PRs only**, not on default-branch pushes: a squash commit is built from
  commits gitleaks already scanned, and direct pushes are blocked by the pre-push hook.
- Every job carries `timeout-minutes`. GitHub's default is 360 — one hung test would burn a
  large slice of a monthly quota in a single incident.

## Merging (your ritual)

<!-- Customize: nothing — these two rules ARE the branch protection until you buy the real thing. -->

- You are the only merger; squash only. The two hard rules (never merge while "Update branch"
  is visible; never merge without green CI on the PR's LATEST commit) are in `AGENTS.md`
  "Getting to master".
- Independent review before merging substantive PRs: a FRESH agent session runs
  `/review <n>` — cross-family review is deliberate. Wait for `VERDICT: approve`,
  **posted as a comment on the PR**. A reviewer that reports a verdict only in its own chat
  window has left you nothing to merge against; if that happens, ask it to post the comment
  before you merge.
- Where `.agents/auto-review.sh` is installed, `/ship` starts that reviewer for you — on
  the PR's creation and on every fix push — so your part is only reading the verdict
  comments. The launcher reports its lifecycle as an **`auto-review` status** in the PR's
  checks list: pending = reviewer running right now, green = verdict comment posted,
  red = reviewer died without posting (the log below says why). A green `auto-review` is
  NOT an approval — it only means the verdict landed; the verdict itself can be a blocker.
  Run `/review <n>` by hand when the auto-run never landed a comment, or when you want a
  second opinion from a different tool.
- The comment's first line is `Reviewed-by: <tool / model family>, head <sha>`, and it is
  the only part you have to read. Two things must be true in it: the family is not the
  author's, and the sha is the PR's latest commit. Either one wrong means the approval on
  screen is not the approval you think you have.

## Emergency overrides (yours alone — agents may never use them)

<!-- Customize: nothing. If an agent ever uses one of these, that is an AGENTS.md "Never" entry. -->

- `ALLOW_DIRECT_PUSH=1 git push …` — direct push to the default branch, past the pre-push hook.
  This clears the LOCAL hook only. If the branch ruleset (the playbook's SETUP.md §2)
  is configured, GitHub still refuses the push — temporarily switch the ruleset to
  Disabled (Settings → Rules → Rulesets, or
  `gh api -X PUT repos/{owner}/{repo}/rulesets/<id> -f enforcement=disabled`), push,
  then switch it back to Active IMMEDIATELY: while it is disabled, nothing protects
  the branch.
- `SKIP_PUSH_GATE=1 git push …` — skip the local static gate.

## When something looks broken

<!-- Customize: add a row every time you had to figure something out twice. -->

| Symptom                        | First move                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| A doc-only PR's `checks` is instant | That's `ci-docs.yml`, the no-op twin — `ci.yml` skips `docs/**` and `**.md` by design |
| CI red on `gitleaks`           | Treat as a real leak until proven otherwise; if real: rotate the credential FIRST     |
| CI red on the build step       | The author fixes it, never you — it fails before the test step, so it fails cheap     |
| PR hygiene red                 | The body is missing its issue link or its `## Docs` answer — the author writes both   |
| No verdict comment after `/ship` | The PR's `auto-review` status says which case: pending = still running; red = died without posting; missing = never launched. Detail: `.git/auto-review-<pr>.log` in the author's working copy |
