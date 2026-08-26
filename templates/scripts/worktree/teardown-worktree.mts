/**
 * Retire a git worktree, or sweep up after the ones nobody retired.
 *
 *   <pkg-manager> run worktree:teardown -- <path|name>   # remove that worktree, then judge its branch
 *   <pkg-manager> run worktree:teardown -- --disposable <path|name>   # force-remove a DETACHED one
 *   <pkg-manager> run worktree:teardown -- --only-finished <path|name>   # retire a provably FINISHED task, else no-op
 *   <pkg-manager> run worktree:teardown -- --sweep       # report leftovers; delete NO branch
 *
 * cwd must be a checkout that is NOT the target — normally the main one:
 * `git worktree remove` cannot run from inside the directory it removes.
 * Its counterpart, `worktree:setup`, is the opposite (no arguments, run
 * inside the worktree). That asymmetry is the constraint, not a preference.
 *
 * The branch is the part worth being careful about. Removing a worktree is
 * cheap and reversible; deleting a branch that holds unpushed work is not.
 * So the branch is only ever deleted behind `classifyBranch()` in
 * worktree-utils.mts, and an unaddressed `--sweep` never deletes one at all
 * — it prints the exact command and lets the human mean it.
 *
 * `--disposable` is the ONE path that passes `--force` to git, and it is
 * gated by `classifyDisposable()`: detached only, no exceptions. It exists
 * for a reviewer's worktree, which is scratch by construction — see that
 * function for why, and note that the plain teardown above is unchanged.
 *
 * `--only-finished` inverts the default posture: instead of "remove unless
 * git refuses", it is "refuse unless the task is provably DONE" — a merged
 * PR containing the branch tip, on a clean tree. Gated by
 * `classifyRetirable()`; built for the worktree collector (gc-worktrees.mts),
 * which hangs this on every worktree with no open workspace and therefore
 * must never turn a closed workspace into a destructive act.
 *
 * Imports nothing but node builtins (see worktree-utils.mts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  classifyBranch,
  classifyDisposable,
  classifyRetirable,
  classifyReviewWorktree,
  computeOrphans,
  dropLeadingSeparators,
  isInside,
  packageManagerFromLockfiles,
  parseWorktreeList,
  reviewWorktreePr,
  type ListedWorktree,
  type WorktreeDirCandidate,
} from "./worktree-utils.mts";

const USAGE = [
  "Usage:",
  "  worktree:teardown -- <path|name>   remove that worktree, then judge its branch",
  "  worktree:teardown -- --disposable <path|name>",
  "                                     force-remove a DETACHED worktree, scratch and all",
  "  worktree:teardown -- --only-finished <path|name>",
  "                                     retire ONLY a provably finished task (merged PR,",
  "                                     clean tree); anything else is a quiet no-op",
  "  worktree:teardown -- --sweep       report leftovers (deletes no branch)",
].join("\n");

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Absolute path, resolved through symlinks where the target still exists. */
function resolvePath(target: string): string {
  const absolute = path.resolve(target);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

let parsed;
try {
  parsed = parseArgs({
    // Not the parseArgs default (raw process.argv): pnpm forwards the `--`
    // separator into the script, and parseArgs reads it as a positional that
    // demotes every flag after it — see dropLeadingSeparators.
    args: dropLeadingSeparators(process.argv.slice(2)),
    options: {
      sweep: { type: "boolean" },
      disposable: { type: "boolean" },
      "only-finished": { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
} catch (error) {
  fail(`${(error as Error).message}\n\n${USAGE}`);
}
const { values, positionals } = parsed;
const modes = [
  values.sweep && "--sweep",
  values.disposable && "--disposable",
  values["only-finished"] && "--only-finished",
].filter(Boolean);

if (modes.length > 1) {
  fail(`${modes.join(" and ")} are different jobs.\n\n${USAGE}`);
}
if (values.sweep && positionals.length > 0) {
  fail(`--sweep takes no target.\n\n${USAGE}`);
}
if (!values.sweep && positionals.length !== 1) {
  fail(`exactly one target is required.\n\n${USAGE}`);
}

const worktrees = parseWorktreeList(
  execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }),
).map((worktree) => ({ ...worktree, path: resolvePath(worktree.path) }));

// The first entry is always the main checkout. Rebound through a plain const:
// TypeScript does not carry the narrowing of a destructured binding into
// functions that close over it, so a bare guard on the destructured name
// would not satisfy `noUncheckedIndexedAccess` there.
const [firstWorktree, ...others] = worktrees;
if (firstWorktree === undefined) throw new Error("git listed no worktrees");
const mainCheckout = firstWorktree;
const cwd = resolvePath(process.cwd());
const pkg = packageManagerFromLockfiles(readdirSync(mainCheckout.path));

// ---------------------------------------------------------------------------
// The branch predicate — the one thing standing between a sweep and lost work
// ---------------------------------------------------------------------------

/**
 * Merged PRs opened from `branch`, as `{ number, headRefOid }`.
 *
 * `undefined` means the question could NOT be asked (no `gh`, no auth, no
 * network). It never collapses into "no merged PR": an unanswered check is
 * reported as unanswered, because "gh is broken" and "this branch has
 * unmerged work" call for completely different actions.
 */
function mergedPrs(branch: string): MergedPr[] | undefined {
  try {
    const out = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "merged",
        "--limit",
        "20",
        "--json",
        "number,headRefOid",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(out) as MergedPr[];
  } catch {
    return undefined;
  }
}

type MergedPr = { number: number; headRefOid: string };

/** Does this repository hold `sha` as a commit object? */
function hasCommit(sha: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the merged head CONTAIN `localHead` — is the tip an ancestor of it,
 * equality included? `undefined` when the question cannot be answered.
 *
 * The head usually has to be fetched first. After a squash-merge with
 * delete-branch-on-merge, `origin/<branch>` is gone and the merged commit is
 * an ancestor of nothing on origin, so a routine `git fetch` never brings
 * it; `refs/pull/<n>/head` is where GitHub still keeps it. A fetch that
 * fails (offline, or GitHub has expired the ref) leaves the question
 * unanswered, which `classifyBranch` reports as a check that did not run —
 * never as "does not contain".
 */
function containsLocalHead(
  localHead: string,
  pr: MergedPr,
): boolean | undefined {
  if (!hasCommit(pr.headRefOid)) {
    const ref = `pull/${pr.number}/head`;
    try {
      execFileSync("git", ["fetch", "--quiet", "origin", ref], {
        stdio: "ignore",
      });
    } catch {
      return undefined;
    }
    if (!hasCommit(pr.headRefOid)) return undefined;
  }

  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", localHead, pr.headRefOid],
      { stdio: "ignore" },
    );
    return true;
  } catch (error) {
    // git says "not an ancestor" with exit 1 and nothing else; any other
    // status is a broken invocation, which is not an answer.
    return (error as { status?: number }).status === 1 ? false : undefined;
  }
}

/**
 * A pull request's state (`OPEN`, `MERGED`, `CLOSED`), or `undefined` when
 * the question could not be asked — same rule as `mergedPrHeads` above.
 */
function prState(pr: number): string | undefined {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", String(pr), "--json", "state", "--jq", ".state"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

function branchFactsFor(branch: string) {
  const localHead = git(["rev-parse", branch]);
  const merged = mergedPrs(branch);

  return {
    branch,
    unpushedCommits: Number(
      git(["rev-list", "--count", branch, "--not", "--remotes=origin"]),
    ),
    localHead,
    mergedPrHeads: merged?.map((pr) => ({
      sha: pr.headRefOid,
      containsLocalHead: containsLocalHead(localHead, pr),
    })),
  };
}

function judgeBranch(branch: string) {
  return classifyBranch(branchFactsFor(branch));
}

// ---------------------------------------------------------------------------
// --sweep
// ---------------------------------------------------------------------------

/**
 * Directories beside the main checkout that carry a `.git` FILE pointing
 * into this repository's `.git/worktrees/`. That file is what makes a
 * directory a worktree of THIS repo — matching on the name would guess.
 */
function findWorktreeDirs(): WorktreeDirCandidate[] {
  const adminDir = path.join(
    path.resolve(process.cwd(), git(["rev-parse", "--git-common-dir"])),
    "worktrees",
  );
  const parent = path.dirname(mainCheckout.path);
  const found: WorktreeDirCandidate[] = [];

  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolvePath(path.join(parent, entry.name));
    if (dir === mainCheckout.path) continue;

    const dotGit = path.join(dir, ".git");
    let gitdirLine: string | undefined;
    try {
      gitdirLine = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
    } catch {
      continue; // no `.git` file (a plain directory, or its own clone)
    }
    if (gitdirLine === undefined) continue;

    const gitdir = path.resolve(dir, gitdirLine.trim());
    if (!isInside(gitdir, adminDir)) continue;

    found.push({ path: dir, adminName: path.basename(gitdir) });
  }

  return found;
}

if (values.sweep) {
  const orphans = computeOrphans({
    worktrees: others,
    candidateDirs: findWorktreeDirs(),
  });

  console.log(`sweeping from ${mainCheckout.path}\n`);

  // 1. Registered, directory gone. This is `git worktree prune`, said out
  //    loud — the plain command cleans up silently and reports nothing.
  if (orphans.prunable.length === 0) {
    console.log("• no stale registrations.");
  } else {
    console.log("• stale registrations (directory gone, git still lists it):");
    for (const worktree of orphans.prunable) {
      console.log(`    ${worktree.path}  [${worktree.branch ?? "detached"}]`);
    }
    git(["worktree", "prune"]);
    console.log("  pruned.");
  }

  // 2. On disk, git no longer knows about it. Nothing prunes these, and
  //    this script will not `rm -rf` a directory on its own initiative.
  if (orphans.strayDirs.length === 0) {
    console.log("• no leftover directories.");
  } else {
    console.log(
      "\n• leftover directories (git does not list them — its branch, if any,\n" +
        "  cannot be derived any more). Remove by hand once you have looked:",
    );
    for (const dir of orphans.strayDirs) console.log(`    rm -rf ${dir}`);
  }

  // 3. Branches of the entries pruned above — SUGGESTIONS ONLY. A targeted
  //    teardown deletes the branch itself (an explicit target is an explicit
  //    intent); an unaddressed sweep never does.
  if (orphans.branches.length === 0) {
    console.log("• no branches left behind.");
  } else {
    console.log("\n• branches whose worktree is gone:");
    for (const branch of orphans.branches) {
      const verdict = judgeBranch(branch);
      console.log(
        verdict.deletable
          ? `    git branch -D ${branch}\n        safe: ${verdict.reason}`
          : `    ${branch} — KEPT: ${verdict.reason}`,
      );
    }
    console.log("\n  Sweep never deletes a branch. Run the lines above yourself.");
  }

  // 4. Per-PR reviewer worktrees that git still lists and disk still holds,
  //    whose PR is done with. Nothing above sees these — they are not orphans,
  //    they are alive and a full checkout's disk each.
  //
  //    These are the OLD scheme: `auto-review.sh` used to review each PR in
  //    its own `<repo>-wt-review-<pr>` and now keeps ONE `<repo>-wt-review`
  //    for the repository. The launcher sweeps the numbered leftovers itself,
  //    but only on its next launch, so this is where the ones it has not
  //    reached yet show up. The unnumbered `<repo>-wt-review` is deliberately
  //    NOT in this list (`reviewWorktreePr` returns null for it): it is the
  //    live reviewer checkout, kept on purpose, and offering to retire it
  //    would be offering to undo the design.
  const reviewLeftovers = others
    .filter((worktree) => !worktree.prunable)
    .map((worktree) => ({ worktree, pr: reviewWorktreePr(worktree.path) }))
    .filter((entry): entry is { worktree: ListedWorktree; pr: number } =>
      entry.pr !== null,
    )
    .map((entry) => {
      // Both predicates, because the name is not evidence: the PR being done
      // says the worktree is a leftover, the detached HEAD says forcing it is
      // safe. Only when both agree does a command get printed.
      const done = classifyReviewWorktree({
        pr: entry.pr,
        state: prState(entry.pr),
      });
      const safe = classifyDisposable(entry.worktree);
      return {
        ...entry,
        offer: done.retirable && safe.disposable,
        reason: done.retirable ? safe.reason : done.reason,
      };
    });

  if (reviewLeftovers.length === 0) {
    console.log("• no reviewer worktrees.");
  } else {
    console.log("\n• reviewer worktrees:");
    for (const { worktree, offer, reason } of reviewLeftovers) {
      console.log(
        offer
          ? `    ${pkg} run worktree:teardown -- --disposable ${worktree.path}\n        safe: ${reason}`
          : `    ${worktree.path} — KEPT: ${reason}`,
      );
    }
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// teardown <path|name>
// ---------------------------------------------------------------------------

const [requested] = positionals;
if (requested === undefined) fail(`exactly one target is required.\n\n${USAGE}`);
const wanted = resolvePath(requested);
const target: ListedWorktree | undefined =
  others.find((worktree) => worktree.path === wanted) ??
  others.find((worktree) => path.basename(worktree.path) === requested);

if (target === undefined) {
  if (wanted === mainCheckout.path || requested === path.basename(mainCheckout.path)) {
    fail(
      `that is the MAIN checkout (${mainCheckout.path}) — it is not a worktree ` +
        "and this script will not remove it.",
    );
  }
  fail(
    `no worktree matches “${requested}”.\n\n  Known worktrees:\n` +
      (others.length === 0
        ? "    (none)"
        : others
            .map((w) => `    ${w.path}  [${w.branch ?? "detached"}]`)
            .join("\n")),
  );
}

if (isInside(cwd, target.path)) {
  fail(
    `cwd is inside the worktree being removed (${target.path}).\n` +
      `  git cannot remove it from within. Run this from ${mainCheckout.path}.`,
  );
}

// ---------------------------------------------------------------------------
// --only-finished: retire on proof, refuse quietly
// ---------------------------------------------------------------------------
//
// This mode exists so teardown can hang on an IMPLICIT gesture — a workspace
// having been closed (see gc-worktrees.mts) — instead of an explicit command.
// Its verdict line is therefore a machine contract, parsed by
// `parseRetireOutcome` in worktree-utils.mts:
// `only-finished: retired — …` / `only-finished: kept (<kind>) — …`.
// Changing that shape silently breaks the collector's notifications.

if (values["only-finished"]) {
  const dirty =
    execFileSync("git", ["-C", target.path, "status", "--porcelain"], {
      encoding: "utf8",
    }).trim() !== "";
  const decision = classifyRetirable({
    branch: target.branch,
    dirty,
    branchFacts: target.branch === null ? null : branchFactsFor(target.branch),
  });

  if (decision.kind !== "retire") {
    console.log(
      `only-finished: kept (${decision.kind.replace(/^kept-/, "")}) — ${decision.reason}`,
    );
    process.exit(0);
  }

  try {
    execFileSync("git", ["worktree", "remove", target.path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
    console.error(`✗ git refused to remove the worktree:\n\n  ${stderr}`);
    console.log("only-finished: error — git refused to remove the worktree");
    process.exit(1);
  }
  git(["branch", "-D", target.branch as string]);
  console.log(
    `only-finished: retired — branch ${target.branch} deleted (${decision.reason})`,
  );
  process.exit(0);
}

console.log(`removing ${target.path}  [${target.branch ?? "detached"}]\n`);

// ---------------------------------------------------------------------------
// --disposable: the one path that forces
// ---------------------------------------------------------------------------

if (values.disposable) {
  const verdict = classifyDisposable(target);
  if (!verdict.disposable) {
    fail(
      `--disposable refuses ${target.path}: ${verdict.reason}.\n` +
        "  Nothing was removed and the branch was NOT touched. Use the plain\n" +
        "  teardown, which stops on a dirty tree instead of forcing.",
    );
  }

  try {
    execFileSync("git", ["worktree", "remove", "--force", target.path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
    console.error("✗ git could not remove the worktree even forced:\n");
    console.error(stderr === "" ? "  (git printed nothing)" : `  ${stderr}`);
    process.exit(1);
  }
  console.log(`✓ worktree removed (forced) — ${verdict.reason}.`);
  console.log("• detached HEAD — no branch to consider.");
  process.exit(0);
}

// Deliberately NO --force. Git's refusal on a dirty tree is the safety net:
// it is the only thing between "tidy up" and someone's uncommitted work.
try {
  execFileSync("git", ["worktree", "remove", target.path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
  console.error("✗ git refused to remove the worktree:\n");
  console.error(stderr === "" ? "  (git printed nothing)" : `  ${stderr}`);
  console.error(
    "\n  That refusal protects work, so it is not overridden here. Commit or stash\n" +
      "  what is in there, or delete the directory by hand and re-run with --sweep.\n" +
      "  The branch was NOT touched.\n",
  );
  process.exit(1);
}
console.log("✓ worktree removed.");

if (target.branch === null) {
  console.log("• detached HEAD — no branch to consider.");
  process.exit(0);
}

const verdict = judgeBranch(target.branch);
if (verdict.deletable) {
  git(["branch", "-D", target.branch]);
  console.log(`✓ branch ${target.branch} deleted — ${verdict.reason}.`);
} else {
  console.log(`• branch ${target.branch} KEPT — ${verdict.reason}.`);
}
