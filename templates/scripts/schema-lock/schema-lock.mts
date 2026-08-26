/**
 * The decision behind `check:schema-lock`, pulled out of the script so it
 * can be tested without a git repository, a GitHub token or a filesystem.
 *
 * Everything here is pure: the caller gathers the facts (git output, `gh`
 * output) and passes them in. The part worth pinning with tests is the part
 * that decides whether the gate goes red.
 *
 * This module imports nothing at all, and its caller imports only node
 * builtins and the two files beside it: the check has to be runnable in a
 * worktree whose install has not happened yet.
 *
 * WHAT counts as the schema surface is deliberately not decided here — that
 * is the module's one per-repo fact, declared in `schema-lock.config.mts`
 * (repo-owned; a sync never touches it) and passed into these functions as a
 * predicate.
 */

/**
 * Is this path part of the shared schema surface that AGENTS.md ("Shared
 * mutable state") allows only ONE in-flight branch to change? Declared per
 * repo in `schema-lock.config.mts`.
 */
export type SchemaPathPredicate = (file: string) => boolean;

/** The schema files among `files`, in input order, deduplicated. */
export function schemaPaths(
  files: readonly string[],
  isSchemaPath: SchemaPathPredicate,
): string[] {
  return [...new Set(files.filter(isSchemaPath))];
}

/** One entry of `git worktree list --porcelain`. */
export type ListedHead = {
  /** Absolute path as git recorded it. */
  path: string;
  /** Branch short name, or `null` for a detached or bare entry. */
  branch: string | null;
  /** That checkout's tip, or `null` for a bare entry, which has none. */
  headSha: string | null;
};

/**
 * Parses `git worktree list --porcelain` into the identity of each checkout:
 * its path, its branch if it has one, and its head sha.
 *
 * The sha is the point. A REVIEWER's worktree is detached — the review resets
 * it to the PR head, and a branch can only be checked out in one worktree —
 * so it has no name for `isSelf` below to recognise it by, and reported the
 * branch under review as conflicting with itself (a live incident). git prints
 * the sha one line above the branch; carrying it through is the whole fix.
 *
 * Deliberately NOT shared with the worktree module's `parseWorktreeList`
 * (`scripts/worktree-utils.mts`): the two modules install independently, and
 * a schema-lock in a repo without the worktree module still needs this
 * parser.
 */
export function parseWorktreeHeads(porcelain: string): ListedHead[] {
  const entries: ListedHead[] = [];
  let current: ListedHead | null = null;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length).trim(),
        branch: null,
        headSha: null,
      };
      entries.push(current);
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("HEAD ")) {
      current.headSha = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    }
  }

  return entries;
}

/** A branch, somewhere, that might also be holding the schema. */
export type SchemaHolder = {
  /** Printed to the human verbatim — e.g. `PR #114` or `worktree ../repo-x`. */
  label: string;
  /** Branch short name, or `null` when the source could not name one. */
  branch: string | null;
  /** That branch's tip, or `null` when the source did not report one. */
  headSha: string | null;
  /** Every file the branch changes against the default branch. */
  files: readonly string[];
};

export type LockFacts = {
  /** The current branch's short name, or `null` on a detached HEAD. */
  selfBranch: string | null;
  /** The current HEAD sha — the fallback identity when there is no branch. */
  selfHead: string;
  /** Every file the current branch changes against the default branch. */
  selfFiles: readonly string[];
  /** Holders reported by the sources that RAN. */
  holders: readonly SchemaHolder[];
  /**
   * Sources that could not be queried at all, named for the human — e.g.
   * `open pull requests (gh unavailable)`. Never folded into an empty
   * `holders`: "not checked" and "checked, found nothing" call for opposite
   * actions.
   */
  unavailableSources: readonly string[];
};

export type LockVerdict = {
  /** True when this branch may proceed to touch the schema. */
  ok: boolean;
  /** What was checked and what was found — printed verbatim. */
  reason: string;
  /** The schema files this branch itself changes. */
  ownSchemaFiles: string[];
  /** Other holders, deduplicated by branch, in `holders` order. */
  conflicts: { label: string; branch: string | null; files: string[] }[];
};

/**
 * Does the current branch stand alone on the schema?
 *
 * The lock is on the SURFACE, not on individual files: two branches that add
 * `0005_a.sql` and `0005_b.sql` share no path and still collide on the
 * version number. So any other in-flight branch touching any schema file is
 * a conflict — file overlap makes it worse, never makes it a conflict.
 *
 * Identity is branch name OR head sha, because the same branch legitimately
 * shows up twice (its own worktree AND its own open PR) and a detached
 * checkout — a reviewer's worktree — has no name to be recognised by.
 */
export function classifySchemaLock(
  facts: LockFacts,
  isSchemaPath: SchemaPathPredicate,
): LockVerdict {
  const ownSchemaFiles = schemaPaths(facts.selfFiles, isSchemaPath);

  // The cheap half, and the common one: ~90% of branches stop here, having
  // asked the network nothing. An unavailable `gh` is irrelevant to them.
  if (ownSchemaFiles.length === 0) {
    return {
      ok: true,
      reason: "this branch changes no schema file — the lock does not apply",
      ownSchemaFiles,
      conflicts: [],
    };
  }

  const isSelf = (holder: SchemaHolder) =>
    (holder.branch !== null && holder.branch === facts.selfBranch) ||
    (holder.headSha !== null && holder.headSha === facts.selfHead);

  const conflicts: LockVerdict["conflicts"] = [];
  const seen = new Set<string>();

  for (const holder of facts.holders) {
    if (isSelf(holder)) continue;
    const files = schemaPaths(holder.files, isSchemaPath);
    if (files.length === 0) continue;
    // The same branch is reported by both sources when it has a worktree AND
    // an open PR. One line per branch; an unnamed holder is never merged away.
    const key = holder.branch ?? ` ${holder.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ label: holder.label, branch: holder.branch, files });
  }

  if (conflicts.length > 0) {
    const who = conflicts
      .map(
        (conflict) =>
          `${conflict.label}${conflict.branch === null ? "" : ` (${conflict.branch})`}` +
          ` — ${conflict.files.join(", ")}`,
      )
      .join("\n    ");
    return {
      ok: false,
      reason:
        `this branch changes ${ownSchemaFiles.join(", ")}, and so does:\n\n    ${who}\n\n` +
        "  Only ONE in-flight branch may change the shared schema surface at a\n" +
        "  time (AGENTS.md → “Shared mutable state”). Ask the human who goes first\n" +
        "  — don't guess, don't race.",
      ownSchemaFiles,
      conflicts,
    };
  }

  if (facts.unavailableSources.length > 0) {
    return {
      ok: false,
      reason:
        `this branch changes ${ownSchemaFiles.join(", ")}, and the check DID NOT RUN ` +
        `for: ${facts.unavailableSources.join(", ")}.\n\n` +
        "  That is an unanswered question, not a clean bill of health. Fix the\n" +
        "  source and re-run, or check by hand who else is holding the schema.",
      ownSchemaFiles,
      conflicts,
    };
  }

  return {
    ok: true,
    reason:
      `this branch changes ${ownSchemaFiles.join(", ")}, and no other ` +
      "in-flight branch touches the schema",
    ownSchemaFiles,
    conflicts,
  };
}
