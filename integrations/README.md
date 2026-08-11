# integrations/ — optional glue to the human's local tooling

One file per tool. Each file is an instruction the adopting agent follows AFTER the core
adoption (ADOPT.md), and only when two things are true: the tool is actually present on
the human's machine, and the human said yes to wiring it. Detection never implies
consent — every integration ends in a question.

## What an integration may change, and what it may never touch

The workflow's moving parts were designed with sockets for exactly this:

| Socket                              | What an integration may do there                       |
| ----------------------------------- | ------------------------------------------------------ |
| `.agents/auto-review.sh`            | choose a different RENDER BASE for it (see below)      |
| `docs/RUNBOOK.md`                   | add lines the human runs (a notify command, a ritual)  |
| the worktree module's runtime probes| nothing to do — the scripts detect the tool themselves |
| a reviewer CLI's hook config        | add tool-specific announcements (e.g. notify on "ask") |

An integration may NEVER touch: the three skills (`do`/`ship`/`review` are
vendor-neutral protocol — the `review` skill already carries the "do what RUNBOOK
prescribes for a landed verdict" socket, which is all an integration needs there:
put the commands on that page, never in the skill), `AGENTS.md`'s rules,
the workflows, the hook. If a tool seems to need a protocol change, that is a playbook
issue, not an integration.

**Render bases.** `.agents/auto-review.sh` is one destination with more than one possible
source: `templates/scripts/auto-review.sh` (the default — headless background process) or
an alternative a tool's page names (e.g. `templates/scripts/auto-review-workspace.sh` for
cmux — visible workspace, reviewer worktree). Whichever base is chosen, `{{REVIEW_CMD}}`
and its contract are the same, and UPDATE.md syncs the file against the base the repo
actually uses.

## Adding a tool

Copy the shape of `cmux.md`: (1) how to DETECT the tool, including "installed but not
answering"; (2) what each socket gets, as concrete render/edit instructions; (3) what the
human loses without the tool — stated honestly, so the question they answer is a real
one; (4) graceful degradation — what must still work when the tool disappears from the
machine later. An integration that breaks the workflow by being absent is wired wrong.
