/**
 * Start a task in one command: worktree, provisioned, in its own workspace.
 *
 *   <pkg-manager> run task:start -- <name> <branch>
 *
 * Three steps that were four manual ones (`git worktree add`, `cd`,
 * `worktree:setup`, then set up a terminal by hand). Four steps repeated
 * every single time is the friction that stops parallel work from starting
 * at all, which is the point of this script.
 *
 * It composes, never duplicates: the worktree provisioning is
 * `worktree:setup` (allowlisted `.env` + install), invoked as a child
 * process inside the new worktree. Its counterpart is `task:finish`.
 *
 * cmux is OPTIONAL. Without it — not installed, or its socket unreachable —
 * the worktree and its setup still happen, the script says the workspace was
 * not created, and it exits 0. A machine without cmux still gets the useful
 * two thirds.
 *
 * Imports nothing but node builtins and the pure module beside it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_AGENT_COMMAND,
  agentLaunchCommand,
  buildLayout,
  findCallerGroup,
  findWorkspace,
  validateTaskName,
  workspaceRefFromAck,
  worktreePathFor,
  type ListedGroup,
  type ListedWorkspace,
} from "./task-utils.mts";
import {
  dropLeadingSeparators,
  packageManagerFromLockfiles,
  parseWorktreeList,
} from "./worktree-utils.mts";

const USAGE = [
  "Usage:",
  "  task:start -- <name> <branch> [prompt...]",
  "",
  "  <name>    short handle: the worktree becomes ../<repo>-wt-<name>",
  "            and the workspace, where a workspace manager exists, is called <name>",
  "  <branch>  the branch to cut from the default branch, e.g. fix/orphan-links",
  "  [prompt]  the agent's FIRST TURN, typed for it at launch — e.g. \"/do 46\".",
  "            Pass it whenever the task is already known: without it the",
  "            workspace opens an agent waiting for input nobody is going to",
  "            type, which is how tasks get spawned and never started.",
].join("\n");

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** cmux, or `null` when this machine has none / its socket is unreachable. */
function cmux(args: string[]): string | null {
  try {
    return execFileSync("cmux", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Suppresses the legacy-alias deprecation notices on stdout.
      env: { ...process.env, CMUX_QUIET: "1" },
    }).trim();
  } catch {
    return null;
  }
}

// dropLeadingSeparators, not raw argv: pnpm forwards the `--` separator into
// the script, where it would land as the task NAME.
const [name, branch, ...promptWords] = dropLeadingSeparators(
  process.argv.slice(2),
);
if (name === undefined || branch === undefined) {
  fail(`a name and a branch are required.\n\n${USAGE}`);
}
// Everything after the branch is the prompt, JOINED rather than required to
// arrive as one pre-quoted argument: the callers that pass it are agents
// typing `task:start -- fix-links fix/links /do 46`, and rejecting exactly
// that invocation would defeat what the argument exists for.
const prompt = promptWords.join(" ");

const nameProblem = validateTaskName(name);
if (nameProblem !== null) fail(`${nameProblem}.\n\n${USAGE}`);

// ---------------------------------------------------------------------------
// 1. Where does it go?
//
// Always a sibling of the MAIN checkout, even when this runs from inside
// another worktree — that is the convention `worktree:teardown --sweep` looks
// in, and a worktree parked elsewhere is invisible to it.
// ---------------------------------------------------------------------------

const worktrees = parseWorktreeList(
  execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }),
);
const [firstWorktree] = worktrees;
if (firstWorktree === undefined) throw new Error("git listed no worktrees");
const mainCheckout = realpathSync(firstWorktree.path);
const target = worktreePathFor(mainCheckout, name);
const pkg = packageManagerFromLockfiles(readdirSync(mainCheckout));

// ---------------------------------------------------------------------------
// 0. Sweep up first — retire finished tasks nobody said goodbye to
//
// Starting new work is the natural moment to collect the old: worktree:gc
// compares disk against open workspaces and retires only what is provably
// DONE (see gc-worktrees.mts). Best-effort on purpose — a broken or slow
// gc must never stop a task from starting. Before the exists-check below,
// so a finished worktree still occupying THIS task's name frees it now.
// ---------------------------------------------------------------------------

console.log(`• ${pkg} run worktree:gc\n`);
try {
  execFileSync(pkg, ["run", "worktree:gc"], {
    cwd: mainCheckout,
    stdio: "inherit",
    timeout: 300_000,
  });
} catch {
  console.log("  (gc did not finish — carrying on; run it yourself later.)");
}
console.log("");

if (existsSync(target)) {
  fail(
    `${target} already exists.\n` +
      "  Pick another name, or retire that one first:\n\n" +
      `    ${pkg} run task:finish -- ${name}`,
  );
}

// git would refuse this too, but after `fetch` and with a message about refs
// rather than about what you should do next.
try {
  git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  fail(
    `branch ${branch} already exists locally.\n` +
      "  Branches are never reused after a merge (AGENTS.md → “Branch discipline”).\n" +
      "  Pick a new name.",
  );
} catch {
  // Expected: the branch does not exist, which is the only way to proceed.
}

// ---------------------------------------------------------------------------
// 2. Worktree, cut from the LATEST default branch
// ---------------------------------------------------------------------------

// origin/HEAD is set on clone but can be missing in old or hand-built
// clones; `set-head --auto` asks the remote once and records the answer.
let base: string;
try {
  base = git(["rev-parse", "--abbrev-ref", "origin/HEAD"]);
} catch {
  try {
    execFileSync("git", ["remote", "set-head", "origin", "--auto"], {
      stdio: "ignore",
    });
    base = git(["rev-parse", "--abbrev-ref", "origin/HEAD"]);
  } catch {
    fail(
      "could not determine the default branch: origin/HEAD is unset and\n" +
        "  `git remote set-head origin --auto` failed (offline?). Run that\n" +
        "  command yourself once, then retry.",
    );
  }
}

console.log(`• git fetch origin --prune`);
try {
  execFileSync("git", ["fetch", "origin", "--prune"], { stdio: "inherit" });
} catch {
  fail("git fetch failed — its output is above.");
}

console.log(`• git worktree add ${target} -b ${branch} ${base}\n`);
try {
  execFileSync("git", ["worktree", "add", target, "-b", branch, base], {
    stdio: "inherit",
  });
} catch {
  fail("git worktree add failed — its output is above.");
}

// ---------------------------------------------------------------------------
// 3. Provision it — the worktree:setup script, not a copy of it
// ---------------------------------------------------------------------------

console.log(`\n• ${pkg} run worktree:setup\n`);
try {
  execFileSync(pkg, ["run", "worktree:setup"], {
    cwd: target,
    stdio: "inherit",
  });
} catch {
  fail(
    "worktree:setup failed — its output is above.\n" +
      `  The worktree EXISTS at ${target}; fix the cause and re-run setup there,\n` +
      `  or remove it with  ${pkg} run task:finish -- ${name}`,
  );
}

// ---------------------------------------------------------------------------
// 4. Workspace — optional, and never fatal
// ---------------------------------------------------------------------------

const agentCommand = process.env.TASK_AGENT_CMD || DEFAULT_AGENT_COMMAND;
// The agent plus its first turn, quoted for the pane's shell. Where no
// workspace gets created below, the prompt was NOT delivered anywhere —
// those branches print this same command so the caller hands it over
// instead of assuming the task started.
const launchCommand = agentLaunchCommand(agentCommand, prompt);
const listed = cmux(["workspace", "list", "--json"]);

if (listed === null) {
  console.log(
    [
      "",
      "• workspace NOT created: cmux is unavailable (not installed, or its socket",
      "  is not answering). The worktree is ready — open it however you like:",
      "",
      `    cd ${target}`,
      ...(prompt === "" ? [] : [`    ${launchCommand}`]),
      "",
    ].join("\n"),
  );
} else {
  const workspaces = (JSON.parse(listed) as { workspaces: ListedWorkspace[] })
    .workspaces;
  const existing = findWorkspace(workspaces, name);

  if (existing.kind !== "none") {
    // cmux would happily make a second one with the same name, which is how
    // you end up unable to say which `task:finish` should close.
    console.log(
      [
        "",
        `• workspace NOT created: one called “${name}” already exists ` +
          `(${existing.kind === "one" ? existing.ref : existing.refs.join(", ")}).`,
        "  cmux does not refuse duplicate names — this script does, so that",
        "  `task:finish` can never guess which one you meant.",
        "",
        `    cd ${target}`,
        ...(prompt === "" ? [] : [`    ${launchCommand}`]),
        "",
      ].join("\n"),
    );
  } else {
    // Beside the caller's own workspaces, not at the bottom of the sidebar.
    // cmux answers "which group holds this workspace?" only from the group
    // side, so the caller's ref is matched against each group's members.
    const identity = cmux(["identify"]);
    const callerRef =
      identity === null
        ? null
        : ((JSON.parse(identity) as { caller?: { workspace_ref?: string } })
            .caller?.workspace_ref ?? null);
    const groupsJson = cmux(["workspace-group", "list", "--json"]);
    const group =
      groupsJson === null
        ? null
        : findCallerGroup(
            (JSON.parse(groupsJson) as { groups: ListedGroup[] }).groups,
            callerRef,
          );

    const created = cmux([
      "workspace",
      "create",
      "--name",
      name,
      "--cwd",
      target,
      "--layout",
      buildLayout(launchCommand),
      "--focus",
      "true",
      ...(group === null ? [] : ["--group", group, "--group-placement", "end"]),
    ]);
    if (created === null) {
      console.log(
        `\n• workspace NOT created: cmux refused. The worktree is ready at ${target}.\n`,
      );
    } else {
      // cmux acknowledges with `OK workspace:N`; print the ref, not the ack.
      // Nothing here uses it as a handle, so the raw line was only ugly — but
      // it is the same ack whose `OK ` prefix silently broke auto-review.sh's
      // reorder, and one of the two call sites printing it verbatim is how
      // that shape reads as normal.
      const ref = workspaceRefFromAck(created) ?? created;
      console.log(
        `\n• workspace “${name}” created (${ref}) — ${launchCommand}`,
      );
    }
  }
}

console.log(
  [
    "",
    `✓ ready: ${target}`,
    `  branch ${branch}, cut from ${base}`,
    "",
    "  Gate: the exact command line is in AGENTS.md → “Getting to master”.",
    "",
    `  When it lands, from ${path.basename(mainCheckout)}:`,
    `         ${pkg} run task:finish -- ${name}`,
    "",
    "  — or from inside the task's own workspace (⌘⇧P → “Finish task” where",
    "  the repo carries .cmux/cmux.json):",
    `         ${pkg} run task:finish -- --here`,
    "",
    "  (either supersedes the `worktree:teardown` line printed by setup above —",
    "   task:finish runs it AND closes the workspace, in that order.)",
    "",
  ].join("\n"),
);
