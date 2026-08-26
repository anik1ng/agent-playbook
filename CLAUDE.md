# CLAUDE.md — for agents working on THIS repository

Rules for editing the agent-playbook repository itself. This file is not part of the
product: nothing in it is copied into adopting repositories.

## This repository is PUBLIC — no private details, ever

Nothing here may identify an adopted repository or a person: no project names, no
domains, no personal paths, no issue numbers from private repos, no personal names, no
e-mail addresses. An incident reference stays fully anonymous — "seen live in an adopted
repo" — the lesson travels, the identity does not. A project name or an e-mail address
in a diff is a blocker; anonymize before committing, in file content AND in the commit
message.

This applies doubly to the `templates/` tree — those files are COPIED into adopting
repositories verbatim, so a literal identity written there would be installed into every
repo that adopts the playbook. Commit identity is per-machine configuration
(`git config user.name` / `user.email`), never a literal in any committed file.

## Committing to this repository

A session whose commits would not verify as the owner's — cloud harnesses sign with
their own ephemeral keys, which GitHub marks "Unverified" — never pushes over git.
It commits through the GitHub API instead: those commits GitHub signs server-side,
so they land attributed to the owner and "Verified". Pushing over git is for the
owner's own machine.
