Closes #<!-- issue number. `Closes`/`Fixes`/`Resolves #N` auto-closes it on merge;
use `Refs #N` for an umbrella issue that stays open; `No issue` if there genuinely
isn't one. The `PR hygiene` check fails without one of these. -->

## What & why

<!-- 2–5 sentences. -->

## How to test by hand

<!-- The ONLY section the human reads before testing. 3–5 concrete click-through
steps: where to go, what to click, what must happen. A flow an automated smoke
suite already covers may say "covered by smoke" instead of repeating its steps. -->

1.

## Risk nearby

<!-- What could this regress? Note test changes explicitly: any deleted/skipped/
weakened test MUST be justified here, or the reviewer treats it as a blocker. -->

-

## Docs

<!-- Doc drift is a bug. Either list every doc this PR updates, one bullet per file
starting with "* " (e.g. "* docs/RUNBOOK.md — new recovery step"), or keep the
`Docs: none` line below and give a real reason after the dash.
The `PR hygiene` check fails without one of the two; the reviewer verifies honesty.
If this PR adds anything the human runs or must remember (script, page, env var,
ritual), docs/RUNBOOK.md MUST be one of the bullets. -->

Docs: none —
