# UPDATE.md — how an agent re-syncs an adopted repository

You are an agent, syncing a repository that ALREADY carries this workflow against the
current playbook. This is the third operation, after `ADOPT.md` (installs, once) and
`SETUP.md` (the human's GitHub configuration, once). This one runs whenever the playbook
has moved and the repo hasn't.

In the adopted repository, the human says:

> Read UPDATE.md from github.com/anik1ng/agent-playbook and sync this repository.

If the current directory is not a git repository, or carries none of the files below, stop
and say so — an un-adopted repo is `ADOPT.md`'s job, not this one.

**An update is not adoption run again.** Adoption renders templates into a repo that is
then free to diverge from them; an update touches only the files that were never supposed
to diverge in the first place, and leaves everything else alone — including where the
playbook's version looks better. Which file is which is the whole content of this page.

## Rule 0 — two classes of file, and one of them is off-limits

### Class A — kept identical to the playbook

These carry no project-specific content by design, so a difference is drift, not
divergence. Compare and sync them **byte-for-byte**:

| In the adopted repo                 | In the playbook                       |
| ----------------------------------- | ------------------------------------- |
| `.agents/skills/do-issue/SKILL.md`  | `templates/skills/do-issue/SKILL.md`  |
| `.agents/skills/ship/SKILL.md`      | `templates/skills/ship/SKILL.md`      |
| `.agents/skills/review-pr/SKILL.md` | `templates/skills/review-pr/SKILL.md` |
| `.github/workflows/pr-hygiene.yml`  | `templates/workflows/pr-hygiene.yml`  |
| `.github/pull_request_template.md`  | `templates/pull_request_template.md`  |
| `.github/dependabot.yml`            | `templates/dependabot.yml`            |
| `.claude/settings.json`             | `templates/settings.json`             |

Three more are Class A with a **declared insertion** — identical to the template apart
from one named, bounded local part, which survives the sync:

- **`.githooks/pre-push`** — carries `{{DEFAULT_BRANCH}}` and `{{PKG_MANAGER}}`.
  Substitute both from THIS repo (the branch from `gh repo view --json defaultBranchRef
  -q .defaultBranchRef.name`, the package manager from the lockfile) and diff the
  substituted render, not the raw template. A diff that is only the placeholders is not a
  difference.
- **`.github/workflows/security.yml`** — its header comment records the date of this
  repo's one-time history secret sweep. That line is this repo's evidence and cannot be
  regenerated; keep it, sync everything around it.
- **`.github/workflows/ci-docs.yml`** — its job `name:` must be byte-identical to the
  `checks` job in THIS repo's `ci.yml` (adoption edits that name when it deletes steps),
  and its `paths:` list is the exact inverse of that file's `paths-ignore:`. Where the
  repo's values still mirror its own `ci.yml`, they are correct — keep them and take the
  playbook's version of the rest of the file. Where they do not mirror it, that is a
  finding for the human: the required check hangs on some class of PR either way.

### Class B — an update NEVER touches these

`AGENTS.md`, `.github/workflows/ci.yml`, `docs/RUNBOOK.md`.

Every one of them is supposed to have grown away from its template. `AGENTS.md` carries
magnet files, "Never" entries and decision records earned from this project's own
incidents; `ci.yml` carries the steps, services and env this toolchain needs, with the
steps adoption deleted staying deleted; `RUNBOOK.md` is the human's page, written for how
they actually operate this repo. Divergence here is the design working, not drift.

So: do not diff them for the purpose of changing them. If you notice a structural
improvement in the playbook's template that this repo would genuinely want — a new
section, a rule worded better, a check the repo is missing — **say it to the human and
stop there.** Name the change and where it would go, and let them decide. Do not apply it,
do not fold it into the sync PR, do not open a second one. A suggestion they decline costs
one line; a Class B file overwritten costs incident history nobody can reconstruct.

## 1. Fetch the playbook

A fresh shallow clone into a temporary directory, deleted when you are done — never a
stale copy from a previous run, and never a partial fetch of single files:

    git clone --depth 1 https://github.com/anik1ng/agent-playbook <tmpdir>

## 2. Diff Class A, file by file

For each row of the table, and each of the three declared-insertion files: compare the
repo's copy against the playbook's (after substitution, for `pre-push`). Four outcomes,
and you report which one per file:

- **identical** — nothing to do.
- **differs** — the playbook has moved; this is what a sync applies.
- **missing in the repo** — a file the playbook added after this repo adopted. Offer it,
  with what it does; a new gate is not something to install silently.
- **present only in the repo** — not yours to delete. Report it and leave it.

## 3. Show the human the summary BEFORE writing anything

One line per file, with what actually changed — not "3 files differ". For a `differs` row,
say which part moved and why the playbook moved it, in a clause the human can decide on.
Then wait. Writing first and showing the diff afterwards makes the review theatre: the
human is left auditing a change that already happened.

## 4. Apply — one branch, one PR

Everything agreed goes into a SINGLE branch and a SINGLE pull request, cut and shipped by
this repo's own rules (`AGENTS.md` "Getting to master", or `/ship` if the repo's skills are
where you found them). You never push to the default branch and never merge.

    chore: sync playbook files

- **Edit the skills at `.agents/skills/<name>/SKILL.md`.** `.claude/skills/<name>` is a
  symlink to that directory; a tool that replaces a file rather than writing through it
  turns the symlink into a real second copy, and a second copy drifts. Check afterwards
  that all three are still symlinks.
- No `{{...}}` token may survive in anything you wrote. The rendered `pre-push` in
  particular is a shell script that runs on every push — a surviving placeholder is a
  broken lock, not a cosmetic bug.
- **The PR body lists, per file, what changed and why** — the playbook's reason for the
  change, not "synced with upstream". The human merges without reading diffs; this body is
  the only account of what moved in files they were told they would never have to think
  about. Fill `## Docs` honestly (a sync usually changes no docs of this repo's own) and
  link an issue or say `No issue`.

## 5. The reverse case — fixes flow playbook-first

Sometimes the diff shows the repo's copy is the better one: a fix someone made locally, a
clarification the playbook never got. Do not overwrite it, and do not quietly keep it
either — **stop and tell the human what the repo has that the playbook doesn't.**

It goes upstream first, into the playbook, and comes back down through a later sync. The
alternative is the failure this whole page exists to prevent: an improvement that lives in
exactly one repository, gets silently reverted by the next sync, and never reaches any of
the others.
