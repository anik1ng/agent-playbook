/**
 * Retire a task started by `task:start`.
 *
 *   <pkg-manager> run task:finish -- <name>
 *
 * Two steps, and their ORDER is the whole design:
 *
 *   1. `worktree:teardown` removes the worktree and judges its branch. If
 *      it refuses — a dirty tree — this script stops and the workspace
 *      stays open, because that workspace is where the uncommitted work is.
 *   2. `cmux workspace close` LAST. Closing a workspace kills its process
 *      tree, so anything after it is code that may never run.
 *
 * The same fact makes running this from INSIDE the workspace being closed a
 * way to kill the script mid-flight. Two guards refuse that before anything
 * happens: cwd inside the target worktree, and — better, because it survives
 * a `cd` — the caller's own workspace being the target one, which cmux will
 * tell us.
 *
 * cmux is OPTIONAL here too: no cmux means step 1 still runs and the script
 * still succeeds.
 *
 * Imports nothing but node builtins and the pure modules beside it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";

import {
  findWorkspace,
  validateTaskName,
  worktreePathFor,
  type ListedWorkspace,
} from "./task-utils.mts";
import {
  isInside,
  packageManagerFromLockfiles,
  parseWorktreeList,
} from "./worktree-utils.mts";

const USAGE = "Usage:\n  task:finish -- <name>";

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function cmux(args: string[]): string | null {
  try {
    return execFileSync("cmux", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CMUX_QUIET: "1" },
    }).trim();
  } catch {
    return null;
  }
}

const [name, ...rest] = process.argv.slice(2);
if (name === undefined || rest.length > 0) {
  fail(`exactly one argument is required.\n\n${USAGE}`);
}

const nameProblem = validateTaskName(name);
if (nameProblem !== null) fail(`${nameProblem}.\n\n${USAGE}`);

const worktrees = parseWorktreeList(
  execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }),
);
const mainCheckout = realpathSync(worktrees[0].path);
const target = worktreePathFor(mainCheckout, name);
const pkg = packageManagerFromLockfiles(readdirSync(mainCheckout));

// ---------------------------------------------------------------------------
// Guards — both BEFORE anything is removed or closed
// ---------------------------------------------------------------------------

const cwd = realpathSync(process.cwd());
if (existsSync(target) && isInside(cwd, realpathSync(target))) {
  fail(
    `you are inside ${target}, the worktree this would remove.\n` +
      `  Run it from the main checkout instead:\n\n` +
      `    cd ${mainCheckout} && ${pkg} run task:finish -- ${name}`,
  );
}

const listed = cmux(["workspace", "list", "--json"]);
const workspaces =
  listed === null
    ? null
    : (JSON.parse(listed) as { workspaces: ListedWorkspace[] }).workspaces;
const match = workspaces === null ? null : findWorkspace(workspaces, name);

if (match !== null && match.kind === "ambiguous") {
  fail(
    `there are ${match.refs.length} cmux workspaces called “${name}”: ${match.refs.join(", ")}.\n` +
      "  Refusing to guess which one you mean. Close the wrong ones yourself:\n\n" +
      match.refs.map((ref) => `    cmux workspace close ${ref}`).join("\n"),
  );
}

if (match !== null && match.kind === "one") {
  // Survives a `cd` out of the worktree, which the cwd guard above does not:
  // the shell running this script still belongs to the workspace that is
  // about to be killed.
  const identity = cmux(["identify"]);
  if (identity !== null) {
    const callerRef = (
      JSON.parse(identity) as { caller?: { workspace_ref?: string } }
    ).caller?.workspace_ref;
    if (callerRef === match.ref) {
      fail(
        `this shell lives in the workspace “${name}” (${match.ref}) that would be closed.\n` +
          "  Closing it kills this script mid-flight. Run it from another workspace.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 1. The worktree — worktree:teardown, predicate and all
// ---------------------------------------------------------------------------

if (existsSync(target)) {
  console.log(`• ${pkg} run worktree:teardown -- ${target}\n`);
  try {
    execFileSync(pkg, ["run", "worktree:teardown", "--", target], {
      cwd: mainCheckout,
      stdio: "inherit",
    });
  } catch {
    fail(
      "worktree:teardown refused — its output is above, and NOTHING else was done.\n" +
        "  The workspace is still open on purpose: that is where the work is.",
    );
  }
} else {
  console.log(`• no worktree at ${target} — nothing to remove.`);
}

// ---------------------------------------------------------------------------
// 2. The workspace — LAST, because closing it kills this process tree
// ---------------------------------------------------------------------------

if (match === null) {
  console.log(
    "• workspace NOT closed: cmux is unavailable — nothing else to do.",
  );
} else if (match.kind === "none") {
  console.log(`• no cmux workspace called “${name}”.`);
} else {
  const closed = cmux(["workspace", "close", match.ref]);
  console.log(
    closed === null
      ? `• workspace “${name}” (${match.ref}) could not be closed — close it by hand.`
      : `• workspace “${name}” (${match.ref}) closed.`,
  );
}

console.log(`\n✓ done: ${name}\n`);
