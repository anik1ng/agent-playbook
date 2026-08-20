/**
 * Machine-enforce AGENTS.md → "Shared mutable state": only ONE in-flight
 * branch may change the shared schema surface at a time.
 *
 *   check:schema-lock   (node scripts/check-schema-lock.mts)
 *
 * Part of the local gate — see AGENTS.md → "Getting to master". Without it
 * the rule is a habit ("check open PRs yourself"), and a habit only holds
 * while the work is serial, i.e. while it isn't needed. Worktrees make
 * parallel starts cheap, so the rule needs a check.
 *
 * The asymmetry that justifies a gate at all: two branches on the schema
 * surface are not a merge conflict — a merge conflict is loud, local and
 * undoable, while two migration numbers cut from the same base can only be
 * sorted out by hand, forward. WHAT counts as that surface is this repo's
 * declaration in `schema-lock.config.mts`.
 *
 * Cheap by construction: a branch that touches no schema file answers green
 * before consulting git for anything else and never invokes `gh`. That is
 * ~90% of branches, and their gate neither slows down nor acquires a network
 * dependency.
 *
 * FAIL-CLOSED. A source that cannot be queried is reported as "did not run"
 * and goes red, never as "found nothing": "gh is broken" and "nobody else
 * holds the schema" must never print the same verdict. Human emergency
 * override — agents: never use it, ask instead:
 *
 *   ALLOW_SCHEMA_CONFLICT=1 node scripts/check-schema-lock.mts
 *
 * Imports nothing but node builtins and the two modules beside it.
 */
import { execFileSync } from "node:child_process";

import { isSchemaPath } from "./schema-lock.config.mts";
import { classifySchemaLock, parseWorktreeHeads, type SchemaHolder } from "./schema-lock.mts";

const OVERRIDE = "ALLOW_SCHEMA_CONFLICT";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function lines(out: string): string[] {
  return out.split("\n").filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// 1. What does THIS branch change?
// ---------------------------------------------------------------------------

/**
 * The default branch's remote ref. Read from git rather than assumed, so the
 * file is byte-identical in a repo whose trunk is called something else. A
 * clone that never learned it is a hard stop with the one-time fix, not a
 * guess: a check diffing against the wrong base is worse than none.
 */
function defaultRef(): string {
  try {
    return git(["rev-parse", "--abbrev-ref", "origin/HEAD"]);
  } catch {
    console.error(
      [
        "",
        "✗ schema lock: this clone does not know the default branch",
        "  (origin/HEAD is unset). One-time fix, then re-run:",
        "",
        "      git remote set-head origin -a",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

const base = defaultRef();

/**
 * Files changed on `ref` since it diverged from the default branch.
 *
 * Three-dot on purpose: two-dot would report every commit that landed on the
 * trunk since, so a branch that changes no schema file would inherit the
 * schema files of whatever merged this week.
 *
 * `origin/HEAD` is read as-is, never fetched: this is a check, and a check
 * that mutates refs behind the caller is worse than a stale one. `ship`
 * fetches and rebases before it runs the gate.
 */
function changedFiles(ref: string): string[] {
  return lines(git(["diff", "--name-only", `${base}...${ref}`]));
}

// `git branch --show-current` is empty on a detached HEAD — the reviewer's
// worktree. That is not an error here: the head sha identifies it instead.
const selfBranch = git(["branch", "--show-current"]) || null;
const selfHead = git(["rev-parse", "HEAD"]);
const selfFiles = changedFiles("HEAD");

// ---------------------------------------------------------------------------
// 2. Who else is holding the schema?
//
// Two sources, and both are needed. `gh` sees branches that reached a PR;
// `git worktree list` sees the ones that have not. The second source is the
// usual hole: a worktree started five minutes ago is invisible to `gh`, and
// that is exactly the window this check exists for.
// ---------------------------------------------------------------------------

const holders: SchemaHolder[] = [];
const unavailableSources: string[] = [];

type PullRequest = {
  number: number;
  headRefName: string;
  headRefOid: string;
  files: { path: string }[];
};

try {
  const out = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,headRefName,headRefOid,files",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const pr of JSON.parse(out) as PullRequest[]) {
    holders.push({
      label: `PR #${pr.number}`,
      branch: pr.headRefName,
      headSha: pr.headRefOid,
      files: pr.files.map((file) => file.path),
    });
  }
} catch {
  unavailableSources.push("open pull requests (gh unavailable)");
}

// Worktrees, the main checkout included: it holds a branch like any other.
// A detached entry contributes no holder — it has no branch of its own to
// be in flight, and its sha is already covered by whichever PR it mirrors.
//
// Both identities are carried through, name AND sha, because a caller may
// have only one of them: a REVIEWER runs this from a detached worktree and
// is nameless, so the branch it is reviewing is recognised as itself by sha
// or not at all (nsarchive#135). The skip below is the same test `isSelf`
// applies — it is here as well only to spare a `git diff` nobody will read.
for (const entry of parseWorktreeHeads(git(["worktree", "list", "--porcelain"]))) {
  if (entry.branch === null) continue;
  if (entry.branch === selfBranch || entry.headSha === selfHead) continue;
  let files: string[];
  try {
    files = changedFiles(entry.branch);
  } catch {
    // A branch git cannot diff (no merge base with the trunk) is not a
    // silent pass: it is a source that did not answer.
    unavailableSources.push(`worktree ${entry.path} (cannot diff ${entry.branch})`);
    continue;
  }
  holders.push({
    label: `worktree ${entry.path}`,
    branch: entry.branch,
    headSha: entry.headSha,
    files,
  });
}

// ---------------------------------------------------------------------------
// 3. Verdict
// ---------------------------------------------------------------------------

const verdict = classifySchemaLock(
  {
    selfBranch,
    selfHead,
    selfFiles,
    holders,
    unavailableSources,
  },
  isSchemaPath,
);

if (verdict.ok) {
  console.log(`✓ schema lock: ${verdict.reason}`);
  process.exit(0);
}

if (process.env[OVERRIDE] === "1") {
  console.log(
    [
      "",
      `⚠ schema lock: ${verdict.reason}`,
      "",
      `  Overridden by ${OVERRIDE}=1 — a HUMAN's call, and it is on the record here.`,
      "  Whoever lands second owns reconciling the schema by hand, forward only.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

console.error(
  [
    "",
    `✗ schema lock: ${verdict.reason}`,
    "",
    `  (emergency override for humans: ${OVERRIDE}=1 node scripts/check-schema-lock.mts)`,
    "",
  ].join("\n"),
);
process.exit(1);
