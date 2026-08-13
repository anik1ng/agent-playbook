/**
 * Retire a task the moment its cmux workspace closes — IF it is provably
 * finished.
 *
 *   <pkg-manager> run task:reaper
 *
 * Long-running, ONE per machine, started by the HUMAN (a dock terminal, a
 * launchd agent — docs/RUNBOOK.md shows both). It listens to cmux's event
 * stream, and for every closed workspace whose directory is a linked git
 * worktree of an adopted repository it runs THAT repository's own
 * `worktree:teardown -- --only-finished`. One reaper therefore serves every
 * adopted repo on the machine: the closed workspace's cwd names the repo,
 * and the repo's own scripts do the judging and the deleting.
 *
 * The design constraint is in the gesture: closing a workspace is a FREE
 * action today — tidy the sidebar, come back tomorrow — and must stay one.
 * So the reaper acts only on proof of DONE (a merged PR containing the
 * branch tip, a clean tree; see `classifyRetirable()` in worktree-utils.mts)
 * and refuses everything else without touching it. The three refusals have
 * three audiences: finished-but-dirty is announced (the human thinks the
 * task is done; the reaper left it for a reason), unfinished and detached
 * are silent (closing an in-review task's workspace or a reviewer's is the
 * normal case), and an unrecognized teardown output is announced as an error.
 *
 * Two closes it never reacts to, by construction rather than by filter: a
 * workspace whose directory is already gone (`task:finish` closed it after
 * its own teardown), and one whose directory is not a linked worktree at all
 * (the main checkout, a scratch terminal). Probed facts this leans on
 * (2026-08-13, cmux 0.64): quitting or relaunching the cmux app emits NO
 * workspace.closed events — restarts do not mass-trigger the reaper — and
 * `cmux events --reconnect` re-attaches by itself when the app comes back.
 * No cursor: closes that happen while the reaper is down are what
 * `worktree:teardown -- --sweep` already exists for.
 *
 * Imports nothing but node builtins and the pure modules beside it.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  closedWorkspaceCwd,
  mainCheckoutFromDotGit,
  parseRetireOutcome,
} from "./reaper-utils.mts";
import { packageManagerFromLockfiles } from "./worktree-utils.mts";

const CMUX_ENV = { ...process.env, CMUX_QUIET: "1" };

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

/** Desktop notification, best-effort — the log above is the record. */
function notify(title: string, body: string): void {
  execFile(
    "cmux",
    ["notify", "--title", title, "--body", body],
    { env: CMUX_ENV },
    () => {},
  );
}

/** `worktree:teardown -- --only-finished` in the repo's own main checkout. */
function runTeardown(
  pkg: string,
  mainCheckout: string,
  worktree: string,
): Promise<{ output: string; failed: boolean }> {
  return new Promise((resolve) => {
    execFile(
      pkg,
      ["run", "worktree:teardown", "--", "--only-finished", worktree],
      { cwd: mainCheckout, timeout: 300_000, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({ output: `${stdout}\n${stderr}`, failed: error !== null });
      },
    );
  });
}

async function handleClosed(reportedCwd: string): Promise<void> {
  let worktree: string;
  try {
    worktree = realpathSync(reportedCwd);
  } catch {
    return; // Directory already gone — task:finish (or a human) got here first.
  }

  let dotGit: string;
  try {
    dotGit = readFileSync(path.join(worktree, ".git"), "utf8");
  } catch {
    return; // No `.git` FILE: a main checkout or a plain directory, not ours.
  }
  const mainCheckout = mainCheckoutFromDotGit(dotGit, worktree);
  if (mainCheckout === null || !existsSync(mainCheckout)) return;

  // Only repos that carry the worktree module — the teardown does the judging,
  // so a repo without it is a repo the reaper has no safe way to act on.
  let scripts: Record<string, unknown>;
  try {
    scripts =
      (
        JSON.parse(
          readFileSync(path.join(mainCheckout, "package.json"), "utf8"),
        ) as { scripts?: Record<string, unknown> }
      ).scripts ?? {};
  } catch {
    return;
  }
  if (typeof scripts["worktree:teardown"] !== "string") return;

  const name = path.basename(worktree);
  const pkg = packageManagerFromLockfiles(readdirSync(mainCheckout));
  log(`workspace closed: ${worktree} — judging`);

  const { output, failed } = await runTeardown(pkg, mainCheckout, worktree);
  const outcome = failed ? "unrecognized" : parseRetireOutcome(output);
  const verdictLine =
    /^only-finished: .*$/m.exec(output)?.[0] ?? output.trim().slice(-200);

  switch (outcome) {
    case "retired":
      log(`${name}: ${verdictLine}`);
      notify("Task retired", `${name}: worktree removed, branch deleted`);
      return;
    case "kept-finished-but-dirty":
      log(`${name}: ${verdictLine}`);
      notify(
        "Task NOT retired",
        `${name}: merged, but the tree holds uncommitted changes — retire it yourself`,
      );
      return;
    case "kept":
      log(`${name}: ${verdictLine}`);
      return;
    case "unrecognized":
      log(`${name}: teardown gave no verdict —\n${output.trim()}`);
      notify("task:reaper error", `${name}: teardown failed — see the reaper log`);
  }
}

async function listen(): Promise<void> {
  for (;;) {
    const child = spawn(
      "cmux",
      ["events", "--category", "workspace", "--reconnect"],
      { env: CMUX_ENV, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.on("error", () => {}); // Reported via the exit path below.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim() !== "") log(`cmux events: ${line}`);
      }
    });

    const lines = createInterface({ input: child.stdout });
    for await (const line of lines) {
      const cwd = closedWorkspaceCwd(line);
      // Sequential on purpose: a burst of closes must not race two teardowns.
      if (cwd !== null) await handleClosed(cwd);
    }

    // `--reconnect` already rides out app restarts; reaching here means the
    // stream itself died (cmux missing, contract change). Retry, slowly.
    log("cmux events stream ended — retrying in 30s");
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

log("task:reaper listening (workspace closed → retire provably finished tasks)");
await listen();
