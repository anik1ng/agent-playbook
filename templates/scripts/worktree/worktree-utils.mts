/**
 * The decisions behind `{{PKG_MANAGER}} run worktree:setup` /
 * `{{PKG_MANAGER}} run worktree:teardown`, pulled out of the scripts so they
 * can be tested without a git repository, a GitHub token or a filesystem.
 *
 * Everything here is pure: the callers gather the facts (git output, `gh`
 * output, directory listings) and pass them in. The scripts stay a thin
 * shell around these functions on purpose — the parts worth pinning with
 * tests are exactly the parts that decide whether something gets DELETED.
 *
 * This module imports nothing but node builtins, and neither do its
 * callers: `worktree:setup` has to run inside a worktree that has no
 * `node_modules` yet.
 */
import path from "node:path";

/**
 * The ONLY variables copied from the main checkout's `.env` into a fresh
 * worktree's `.env`.
 *
 * An allowlist, not a denylist, and that is the whole point: a variable
 * added to `.env` later does NOT leak into worktrees by default. Nobody
 * remembers a new key; a broken gate announces itself.
 *
 * It ships EMPTY. Add a key here only when the local gate actually reads
 * it — each entry is a declaration that every worktree, including a
 * REVIEWER's worktree where another vendor's model does the work, may see
 * that value. Keeping secrets out of that field of view is the reason the
 * filter exists, not a side effect. Never add secrets or privileged roles
 * (API keys, auth secrets, a DDL/superuser database URL).
 */
export const ALLOWED_ENV_VARS: readonly string[] = [];

/** `KEY=value`, optionally `export`-prefixed. Comments and blanks miss. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Every variable name assigned in a `.env`-shaped file, in file order. */
export function envKeys(source: string): string[] {
  return source
    .split("\n")
    .map((line) => ASSIGNMENT.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

export type FilteredEnv = {
  /** The `.env` to write into the worktree. */
  text: string;
  /** Names carried over, in file order. */
  copied: string[];
  /** Names deliberately left behind, in file order. */
  skipped: string[];
};

/**
 * Reduces the main checkout's `.env` to what a worktree is allowed to see.
 *
 * Comments are dropped rather than carried: the source file's prose talks
 * about variables that are no longer there, which would be worse than no
 * prose at all. A short header explains where the file came from.
 */
export function filterEnv(
  source: string,
  allowedVars: readonly string[] = ALLOWED_ENV_VARS,
): FilteredEnv {
  const allowed = new Set<string>(allowedVars);
  const copied: string[] = [];
  const skipped: string[] = [];
  const kept: string[] = [];

  for (const line of source.split("\n")) {
    const key = ASSIGNMENT.exec(line)?.[1];
    if (key === undefined) continue;
    if (allowed.has(key)) {
      copied.push(key);
      kept.push(line.trim());
    } else {
      skipped.push(key);
    }
  }

  const header = [
    "# Written by `worktree:setup` — do not edit by hand unless you mean to.",
    "#",
    "# Only the variables the local gate actually needs are copied from the main",
    "# checkout; everything else is withheld on purpose (secrets, privileged roles).",
    "# The allowlist lives in scripts/worktree-utils.mts; see docs/RUNBOOK.md.",
    "",
  ].join("\n");

  return { text: `${header}${kept.join("\n")}\n`, copied, skipped };
}

export type ListedWorktree = {
  /** Absolute path as git recorded it. */
  path: string;
  /** Branch short name, or `null` for a detached / bare entry. */
  branch: string | null;
  /** git considers the registration stale — the directory is gone. */
  prunable: boolean;
};

/**
 * Parses `git worktree list --porcelain`. The FIRST entry is always the
 * main checkout — every caller here depends on that ordering.
 */
export function parseWorktreeList(porcelain: string): ListedWorktree[] {
  const entries: ListedWorktree[] = [];
  let current: ListedWorktree | null = null;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length).trim(),
        branch: null,
        prunable: false,
      };
      entries.push(current);
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true;
    }
  }

  return entries;
}

/** A merged pull request's head, and how the local branch tip sits under it. */
export type MergedPrHead = {
  /** The head commit GitHub merged. */
  sha: string;
  /**
   * Does this head CONTAIN the branch's local tip — is the tip an ancestor
   * of it, equality included? `undefined` when the question could not be
   * answered at all (the commit is not in the local object store and the
   * fetch that would bring it failed), which is "not checked", never "no".
   *
   * The caller computes this, because it needs git; see teardown-worktree.mts.
   */
  containsLocalHead: boolean | undefined;
};

export type BranchFacts = {
  branch: string;
  /** Commits on the branch that exist under no `origin/*` ref. */
  unpushedCommits: number;
  /** The branch's local tip. */
  localHead: string;
  /**
   * MERGED pull requests opened from this branch. `[]` means the query ran
   * and found none; `undefined` means it could not be run at all (no `gh`,
   * not authenticated, no network) — which is "not checked", never "unsafe".
   */
  mergedPrHeads: MergedPrHead[] | undefined;
};

export type BranchVerdict = {
  /** True only when deleting the branch can lose nothing. */
  deletable: boolean;
  /** What was checked, what was found — printed verbatim to the human. */
  reason: string;
};

const short = (sha: string) => sha.slice(0, 7);

/**
 * May this local branch be deleted? A disjunction of two independent
 * checks, and BOTH are needed:
 *
 *  1. Everything is on origin — nothing local would be lost.
 *  2. A PR from this branch was merged at a head that CONTAINS the tip.
 *
 * Check 1 alone is useless under this workflow: merges are squashes and
 * delete-branch-on-merge is on, so after a merge the branch's commits are
 * ancestors of nothing on origin and `origin/<branch>` is gone — a merged
 * branch looks permanently unpushed, and sweep would never offer the one
 * thing it exists for.
 *
 * Check 2 alone loses data: PR merged, branch kept, someone commits on top
 * and never pushes. Check 1 says "local commits", check 2 says "merged",
 * and a human reading a confident "merged" rubber-stamps the deletion. So
 * check 2 counts only when the merged head contains the branch's tip.
 *
 * CONTAINMENT, not equality. GitHub's "Update branch" button writes a
 * merge commit onto the branch, so the head that gets merged is routinely
 * one commit AHEAD of the tip that is checked out locally — and a ruleset
 * requiring up-to-date branches makes that button a near-universal step.
 * Equality refused all of those with a message claiming work had landed
 * after the merge, which was false every time; a false alarm you see on
 * every branch trains you to ignore the one that is real. The dangerous
 * case stays closed: commits written after the merge and never pushed put
 * the tip OUTSIDE the merged head, so containment is false exactly where
 * equality was.
 */
export function classifyBranch(facts: BranchFacts): BranchVerdict {
  const { unpushedCommits: unpushed, localHead, mergedPrHeads } = facts;

  if (unpushed === 0) {
    return {
      deletable: true,
      reason: "every commit on it is on origin — nothing local to lose",
    };
  }

  const commits =
    unpushed === 1 ? "1 commit exists" : `${unpushed} commits exist`;

  if (mergedPrHeads === undefined) {
    return {
      deletable: false,
      reason:
        `${commits} only here, and the merged-PR check DID NOT RUN ` +
        "(gh unavailable). That is an unanswered question, not a verdict — " +
        "re-run with gh working, or check the PR yourself",
    };
  }

  const containing = mergedPrHeads.find(
    (head) => head.containsLocalHead === true,
  );
  if (containing !== undefined) {
    return {
      deletable: true,
      reason:
        containing.sha === localHead
          ? `a PR from it was merged at this exact head (${short(localHead)})`
          : `a PR from it was merged at ${short(containing.sha)}, which ` +
            `contains this branch's tip (${short(localHead)}) — the usual ` +
            "shape after “Update branch”",
    };
  }

  // Only after every head has been asked: one answered containment beats any
  // number of unanswerable ones, and an unanswerable one beats the finding
  // below, which is a claim about the branch rather than about the check.
  const heads = (subset: MergedPrHead[]) =>
    subset.map((head) => short(head.sha)).join(", ");

  const unanswered = mergedPrHeads.filter(
    (head) => head.containsLocalHead === undefined,
  );
  if (unanswered.length > 0) {
    return {
      deletable: false,
      reason:
        `a PR from it was merged at ${heads(unanswered)}, but whether that ` +
        `contains the branch tip (${short(localHead)}) DID NOT RUN — the ` +
        "commit is not in this repository and fetching it failed. Re-run " +
        "with the network up, or check the PR yourself",
    };
  }

  if (mergedPrHeads.length > 0) {
    return {
      deletable: false,
      reason:
        `a PR from it was merged at ${heads(mergedPrHeads)}, but that does ` +
        `not contain the branch tip ${short(localHead)} — work landed on it ` +
        "AFTER the merge and was never pushed. Sort it out by hand",
    };
  }

  return {
    deletable: false,
    reason: `${commits} only here, and no merged PR was found for it`,
  };
}

export type DisposableFacts = {
  /** The worktree's path — quoted back in the verdict, never parsed. */
  path: string;
  /** Branch short name, or `null` for a detached worktree. */
  branch: string | null;
};

export type DisposableVerdict = {
  /** True only when a forced removal can lose nothing anyone wanted. */
  disposable: boolean;
  /** What was checked, what was found — printed verbatim to the human. */
  reason: string;
};

/**
 * May this worktree be removed with `--force`, scratch files and all?
 *
 * ONLY when it is detached. That is the whole predicate, and it is the
 * machine part of the safety net the plain teardown gets from git's own
 * refusal on a dirty tree.
 *
 * The case this exists for is a REVIEWER's worktree: detached on a PR's
 * head, never pushed from, never edited as a source tree. Everything that
 * appears in it beyond the commit is an agent's scratch (diffs, probe files),
 * and its real output — the verdict — is already a comment on the PR. So
 * git's refusal there protects nothing and costs a full checkout's disk
 * per reviewed PR.
 *
 * A worktree WITH a branch is the opposite: somebody's uncommitted work may
 * be the only copy of itself. The check is deliberately the branch and not
 * the directory name — a name says what someone called it, a detached HEAD
 * says what git knows about it.
 */
export function classifyDisposable(facts: DisposableFacts): DisposableVerdict {
  if (facts.branch !== null) {
    return {
      disposable: false,
      reason:
        `it has a branch (${facts.branch}), so it is somebody's working copy — ` +
        "only a detached worktree is disposable",
    };
  }
  return {
    disposable: true,
    reason: "detached HEAD — nothing in it exists only here",
  };
}

/** `-wt-review-<pr>` at the end of a directory name; the rest is the repo's prefix. */
const REVIEW_DIR = /-wt-review-(\d+)$/;

/**
 * The PR number a reviewer worktree's directory name encodes, or `null`.
 *
 * Name-matching, unavoidably: nothing else on disk records which PR a
 * detached checkout belongs to. It decides only whether to ASK GitHub about
 * a directory — never whether to delete one. That stays `classifyDisposable`.
 */
export function reviewWorktreePr(dirPath: string): number | null {
  const name = dirPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
  const match = REVIEW_DIR.exec(name);
  return match === null ? null : Number(match[1]);
}

export type ReviewWorktreeFacts = {
  pr: number;
  /**
   * The PR's state as `gh` reported it (`OPEN`, `MERGED`, `CLOSED`), or
   * `undefined` when the question could not be asked at all.
   */
  state: string | undefined;
};

export type ReviewWorktreeVerdict = {
  /** True only when the PR is provably done with. */
  retirable: boolean;
  reason: string;
};

/**
 * Is this reviewer worktree a leftover?
 *
 * `undefined` is "not checked", never "closed" — the same rule
 * `classifyBranch` follows. A sweep that reported an unanswered `gh` as a
 * retirable worktree would be printing a deletion command for a review that
 * may still be running.
 */
export function classifyReviewWorktree(
  facts: ReviewWorktreeFacts,
): ReviewWorktreeVerdict {
  if (facts.state === undefined) {
    return {
      retirable: false,
      reason: `could not ask GitHub about PR #${facts.pr} — check did not run`,
    };
  }
  if (facts.state === "OPEN") {
    return { retirable: false, reason: `PR #${facts.pr} is still open` };
  }
  return {
    retirable: true,
    reason: `PR #${facts.pr} is ${facts.state.toLowerCase()}`,
  };
}

/** A directory beside the main checkout that claims to be one of its worktrees. */
export type WorktreeDirCandidate = {
  path: string;
  /** The `.git/worktrees/<name>` entry its `.git` file points at. */
  adminName: string;
};

export type OrphanFacts = {
  /** Worktrees git still lists, the main checkout EXCLUDED by the caller. */
  worktrees: ListedWorktree[];
  /** Directories on disk whose `.git` file points into this repo's admin dir. */
  candidateDirs: WorktreeDirCandidate[];
};

export type Orphans = {
  /** Registered, but the directory is gone — `git worktree prune` territory. */
  prunable: ListedWorktree[];
  /** On disk, but git no longer knows about them — nothing prunes these. */
  strayDirs: string[];
  /**
   * Branches left behind by the prunable entries. SUGGESTIONS ONLY: an
   * unaddressed sweep never deletes a branch (see teardown-worktree.mts).
   */
  branches: string[];
};

/** Splits the facts into the three classes of leftover a sweep reports. */
export function computeOrphans(facts: OrphanFacts): Orphans {
  const prunable = facts.worktrees.filter((worktree) => worktree.prunable);
  const listed = new Set(facts.worktrees.map((worktree) => worktree.path));

  const strayDirs = facts.candidateDirs
    .filter((candidate) => !listed.has(candidate.path))
    .map((candidate) => candidate.path);

  const branches = [
    ...new Set(
      prunable
        .map((worktree) => worktree.branch)
        .filter((branch): branch is string => branch !== null),
    ),
  ];

  return { prunable, strayDirs, branches };
}

/** Is `inner` the same path as `outer`, or inside it? */
export function isInside(inner: string, outer: string): boolean {
  const relative = path.relative(outer, inner);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
