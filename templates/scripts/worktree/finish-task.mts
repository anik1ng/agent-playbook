/**
 * Retire a task started by `task:start`.
 *
 *   <pkg-manager> run task:finish -- <name>     # from the main checkout / another workspace
 *   <pkg-manager> run task:finish -- --here     # from inside the task's own worktree
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
 * `--here` is the one legal way THROUGH those guards, not around them: run
 * with no name from inside the task's worktree, it derives the name from the
 * directory (`taskNameFromWorktreePath`) and re-executes this same script
 * DETACHED — its own session via `spawn(..., { detached: true })`, cwd moved
 * to the main checkout, the `CMUX_*` identity variables cleared so `cmux
 * identify` no longer names the doomed workspace as the caller. The detached
 * child then passes both guards on their own terms and survives the
 * workspace's process tree being killed. Its output goes to a log beside the
 * repo's other machine logs (`.git/task-finish-<name>.log`), and because
 * nobody is watching that log, every OUTCOME is also announced as a desktop
 * notification (`--announce`, the internal flag the re-exec adds): retired,
 * refused-dirty, or could-not-close. A refusal that only a log file saw
 * would be indistinguishable from the feature not existing.
 *
 * The workspace is found by TITLE first and by CURRENT DIRECTORY second
 * (`resolveTaskWorkspace`): titles are human-readable and get renamed,
 * cwds do not — a renamed workspace used to mean the teardown ran but the
 * workspace stayed open, looking half-done.
 *
 * cmux is OPTIONAL here too: no cmux means the teardown still runs and the
 * script still succeeds — `--here` included, there is just no workspace to
 * close and no notification channel, only the log.
 *
 * Imports nothing but node builtins and the pure modules beside it.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  resolveTaskWorkspace,
  taskNameFromWorktreePath,
  validateTaskName,
  worktreePathFor,
  type ListedWorkspace,
} from "./task-utils.mts";
import {
  dropLeadingSeparators,
  isInside,
  packageManagerFromLockfiles,
  parseWorktreeList,
} from "./worktree-utils.mts";

const USAGE = [
  "Usage:",
  "  task:finish -- <name>    from the main checkout (or any other workspace)",
  "  task:finish -- --here    from inside the task's own worktree: detaches,",
  "                           retires it, closes this very workspace",
].join("\n");

// dropLeadingSeparators, not raw argv: pnpm forwards the `--` separator into
// the script, and a literal "--" in the positionals breaks the name check.
const args = dropLeadingSeparators(process.argv.slice(2));
const here = args.includes("--here");
// Internal: set by the detached re-exec below, never typed by a human. It
// switches the audience — outcomes go to `cmux notify`, because stdout is a
// log file nobody is watching.
const announce = args.includes("--announce");
const positionals = args.filter((arg) => arg !== "--here" && arg !== "--announce");

/** Desktop notification, best-effort — the log is the record. */
function notify(title: string, body: string): void {
  try {
    execFileSync("cmux", ["notify", "--title", title, "--body", body], {
      stdio: "ignore",
      env: { ...process.env, CMUX_QUIET: "1" },
    });
  } catch {
    // No cmux, no notification — the log still has everything.
  }
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  if (announce) notify("task:finish failed", message.split("\n")[0]);
  process.exit(1);
}

function cmux(cmuxArgs: string[]): string | null {
  try {
    return execFileSync("cmux", cmuxArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CMUX_QUIET: "1" },
    }).trim();
  } catch {
    return null;
  }
}

const worktrees = parseWorktreeList(
  execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }),
);
const mainCheckout = realpathSync(worktrees[0].path);
const pkg = packageManagerFromLockfiles(readdirSync(mainCheckout));

// ---------------------------------------------------------------------------
// --here: derive the name, then re-exec detached and get out of the way
// ---------------------------------------------------------------------------

if (here) {
  if (positionals.length > 0) {
    fail(`--here takes no name — the worktree you are in names the task.\n\n${USAGE}`);
  }

  const cwd = realpathSync(process.cwd());
  const host = worktrees
    .slice(1)
    .find((worktree) => existsSync(worktree.path) && isInside(cwd, realpathSync(worktree.path)));
  if (host === undefined) {
    fail(
      "--here must run from inside a task worktree, and this directory is not one.\n" +
        `  From anywhere else, name the task instead:\n\n` +
        `    ${pkg} run task:finish -- <name>`,
    );
  }

  const name = taskNameFromWorktreePath(mainCheckout, realpathSync(host.path));
  if (name === null) {
    fail(
      `${host.path} is a worktree, but not a ${path.basename(mainCheckout)}-wt-<name> ` +
        "sibling of the main checkout — task:finish only retires what task:start " +
        `created. Use ${pkg} run worktree:teardown -- ${host.path} from the main checkout.`,
    );
  }

  const gitCommonDir = path.resolve(
    cwd,
    execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim(),
  );
  const logPath = path.join(gitCommonDir, `task-finish-${name}.log`);
  const log = openSync(logPath, "a");

  // The child must not inherit this workspace's identity: `cmux identify`
  // reads CMUX_WORKSPACE_ID / CMUX_SURFACE_ID from the environment
  // [read-in-source, cmux CLI, 2026-08-14], and with them cleared the
  // caller-workspace guard below correctly sees nobody instead of the
  // workspace being closed.
  const env: Record<string, string | undefined> = {
    ...process.env,
    CMUX_QUIET: "1",
  };
  delete env.CMUX_WORKSPACE_ID;
  delete env.CMUX_SURFACE_ID;
  delete env.CMUX_WINDOW_ID;

  const child = spawn(pkg, ["run", "task:finish", "--", name, "--announce"], {
    cwd: mainCheckout,
    detached: true,
    stdio: ["ignore", log, log],
    env,
  });
  child.unref();

  console.log(
    [
      "",
      `• retiring “${name}” in a detached process (pid ${child.pid}).`,
      "  If the teardown succeeds this workspace closes itself in a moment;",
      "  if it refuses (uncommitted work), the workspace stays open and a",
      "  notification says why. Either way the record is:",
      "",
      `    ${logPath}`,
      "",
    ].join("\n"),
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// task:finish -- <name>
// ---------------------------------------------------------------------------

const [name, ...rest] = positionals;
if (name === undefined || rest.length > 0) {
  fail(`exactly one argument is required.\n\n${USAGE}`);
}

const nameProblem = validateTaskName(name);
if (nameProblem !== null) fail(`${nameProblem}.\n\n${USAGE}`);

if (announce) {
  console.log(`\n=== task:finish ${name} — detached run ===`);
}

const target = worktreePathFor(mainCheckout, name);

// ---------------------------------------------------------------------------
// Guards — both BEFORE anything is removed or closed
// ---------------------------------------------------------------------------

const cwd = realpathSync(process.cwd());
if (existsSync(target) && isInside(cwd, realpathSync(target))) {
  fail(
    `you are inside ${target}, the worktree this would remove.\n` +
      `  Run it from the main checkout instead:\n\n` +
      `    cd ${mainCheckout} && ${pkg} run task:finish -- ${name}\n\n` +
      `  — or, from in here, simply:\n\n` +
      `    ${pkg} run task:finish -- --here`,
  );
}

const listed = cmux(["workspace", "list", "--json"]);
const workspaces =
  listed === null
    ? null
    : (JSON.parse(listed) as { workspaces: ListedWorkspace[] }).workspaces.map(
        (workspace) => {
          // resolveTaskWorkspace compares paths; normalization is this
          // caller's job because the pure module has no filesystem. A cwd
          // that no longer exists stops being a match candidate.
          if (
            typeof workspace.current_directory !== "string" ||
            workspace.current_directory === ""
          ) {
            return workspace;
          }
          try {
            return {
              ...workspace,
              current_directory: realpathSync(workspace.current_directory),
            };
          } catch {
            return { ...workspace, current_directory: null };
          }
        },
      );
const match =
  workspaces === null
    ? null
    : resolveTaskWorkspace(
        workspaces,
        name,
        existsSync(target) ? realpathSync(target) : null,
      );

if (match !== null && match.kind === "ambiguous") {
  fail(
    `there are ${match.refs.length} cmux workspaces matching “${name}”: ${match.refs.join(", ")}.\n` +
      "  Refusing to guess which one you mean. Close the wrong ones yourself:\n\n" +
      match.refs.map((ref) => `    cmux workspace close ${ref}`).join("\n"),
  );
}

if (match !== null && match.kind === "one") {
  // Survives a `cd` out of the worktree, which the cwd guard above does not:
  // the shell running this script still belongs to the workspace that is
  // about to be killed. (The --here re-exec passes this legitimately — its
  // environment carries no workspace identity, so there is no caller here.)
  const identity = cmux(["identify"]);
  if (identity !== null) {
    const callerRef = (
      JSON.parse(identity) as { caller?: { workspace_ref?: string } }
    ).caller?.workspace_ref;
    if (callerRef === match.ref) {
      fail(
        `this shell lives in the workspace “${name}” (${match.ref}) that would be closed.\n` +
          "  Closing it kills this script mid-flight. Run it from another workspace,\n" +
          `  or from in there:  ${pkg} run task:finish -- --here`,
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
    if (announce) {
      notify(
        "Task NOT retired",
        `${name}: teardown refused — uncommitted work is in the worktree, the workspace stays open`,
      );
    }
    console.error(
      "\n✗ worktree:teardown refused — its output is above, and NOTHING else was done.\n" +
        "  The workspace is still open on purpose: that is where the work is.\n",
    );
    process.exit(1);
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
  console.log(`• no cmux workspace matches “${name}”.`);
  if (announce) {
    notify("Task retired", `${name}: worktree removed (no workspace to close)`);
  }
} else {
  // Announce BEFORE closing: in a --here run this very notification is the
  // success report, and the close may take the caller's terminal with it.
  if (announce) {
    notify(
      "Task retired",
      `${name}: worktree removed, workspace closing — branch verdict in .git/task-finish-${name}.log`,
    );
  }
  const closed = cmux(["workspace", "close", match.ref]);
  console.log(
    closed === null
      ? `• workspace “${name}” (${match.ref}) could not be closed — close it by hand.`
      : `• workspace “${name}” (${match.ref}) closed.`,
  );
  if (closed === null && announce) {
    notify(
      "task:finish",
      `${name}: worktree removed, but the workspace would not close — close it by hand`,
    );
  }
}

console.log(`\n✓ done: ${name}\n`);
