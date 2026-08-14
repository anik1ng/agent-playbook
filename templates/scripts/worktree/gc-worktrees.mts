/**
 * Retire the finished tasks nobody said goodbye to.
 *
 *   <pkg-manager> run worktree:gc
 *
 * State reconciliation, not event listening: compare the linked worktrees on
 * disk with the cwds of the workspaces currently OPEN in cmux, and hand every
 * worktree that has no open workspace to `worktree:teardown --only-finished`
 * — which retires it only on PROOF of done (a merged PR containing the
 * branch tip, a clean tree; `classifyRetirable()`) and refuses everything
 * else untouched.
 *
 * This replaced the long-running reaper (`task:reaper`), and the shape of the
 * replacement is the point: a daemon listening for `workspace.closed` had to
 * be kept alive by the human, needed a cursor to survive its own downtime,
 * and was still blind to the closes that emit no event at all — quitting or
 * relaunching cmux [verified-by-execution, 2026-08-13, cmux 0.64]. Comparing
 * CURRENT state needs none of that: however a workspace disappeared — closed
 * by hand, closed by `task:finish`, gone with the app — its worktree is
 * simply "present on disk, open nowhere" the next time this runs. Runs are
 * one-shot and idempotent; `task:start` runs one in its preamble, so starting
 * new work sweeps up after the finished work, and nobody keeps anything
 * running.
 *
 * Fail closed: no cmux (or an unreadable workspace list) means every
 * worktree might be someone's open session, so NOTHING is offered. And no
 * verdict here is a deletion decision — the teardown's predicate is the only
 * judge, same as it was for the reaper.
 *
 * Imports nothing but node builtins and the pure modules beside it.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";

import {
  gcCandidates,
  packageManagerFromLockfiles,
  parseRetireOutcome,
  parseWorktreeList,
} from "./worktree-utils.mts";

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

/** Desktop notification, best-effort — stdout is the record. */
function notify(title: string, body: string): void {
  try {
    execFileSync("cmux", ["notify", "--title", title, "--body", body], {
      stdio: "ignore",
      env: { ...process.env, CMUX_QUIET: "1" },
    });
  } catch {
    // No cmux, no notification.
  }
}

const worktrees = parseWorktreeList(
  execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }),
).map((worktree) => {
  try {
    return { ...worktree, path: realpathSync(worktree.path) };
  } catch {
    return worktree; // prunable: the directory is gone, gcCandidates skips it
  }
});
const [mainCheckout, ...others] = worktrees;
const pkg = packageManagerFromLockfiles(readdirSync(mainCheckout.path));

const listed = cmux(["workspace", "list", "--json"]);
let openDirectories: string[] | null = null;
if (listed !== null) {
  try {
    openDirectories = (
      JSON.parse(listed) as {
        workspaces: { current_directory?: string | null }[];
      }
    ).workspaces
      .map((workspace) => workspace.current_directory)
      .filter((dir): dir is string => typeof dir === "string" && dir !== "")
      .flatMap((dir) => {
        try {
          return [realpathSync(dir)];
        } catch {
          return []; // a workspace whose cwd no longer exists guards nothing
        }
      });
  } catch {
    openDirectories = null; // unparseable is "could not ask", never "none open"
  }
}

if (openDirectories === null) {
  console.log(
    "worktree:gc — cmux is unavailable, so which worktrees are open cannot be " +
      "known. Nothing was touched (fail closed).",
  );
  process.exit(0);
}

const candidates = gcCandidates({ worktrees: others, openDirectories });

if (candidates.length === 0) {
  console.log("worktree:gc — every worktree is open in a workspace (or none exist). Nothing to do.");
  process.exit(0);
}

for (const candidate of candidates) {
  console.log(`worktree:gc — no open workspace on ${candidate.path}, judging:`);

  let output: string;
  let failed = false;
  try {
    output = execFileSync(
      pkg,
      ["run", "worktree:teardown", "--", "--only-finished", candidate.path],
      { cwd: mainCheckout.path, timeout: 300_000, encoding: "utf8" },
    );
  } catch (error) {
    const raised = error as { stdout?: string; stderr?: string };
    output = `${raised.stdout ?? ""}\n${raised.stderr ?? ""}`;
    failed = true;
  }

  const outcome = failed ? "unrecognized" : parseRetireOutcome(output);
  const verdictLine =
    /^only-finished: .*$/m.exec(output)?.[0] ?? output.trim().slice(-200);

  switch (outcome) {
    case "retired":
      console.log(`  ${verdictLine}`);
      notify("Task retired", `${candidate.branch}: worktree removed, branch deleted`);
      break;
    case "kept-finished-but-dirty":
      console.log(`  ${verdictLine}`);
      notify(
        "Task NOT retired",
        `${candidate.branch}: merged, but the tree holds uncommitted changes — retire it yourself`,
      );
      break;
    case "kept":
      console.log(`  ${verdictLine}`);
      break;
    case "unrecognized":
      console.log(`  teardown gave no verdict —\n${output.trim()}`);
      notify("worktree:gc error", `${candidate.path}: teardown failed — see the output`);
      break;
  }
}
