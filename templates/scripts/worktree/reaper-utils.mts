/**
 * The decisions behind `task:reaper`, pulled out of the long-running script
 * so they can be tested without cmux, a git repository or a filesystem —
 * same contract as worktree-utils.mts: everything here is pure, the caller
 * gathers the facts and passes them in.
 *
 * Imports nothing but node builtins.
 */
import path from "node:path";

/**
 * The `cwd` of a `workspace.closed` event, or `null` for every other line
 * the `cmux events` stream produces.
 *
 * `null` is deliberately the answer to EVERYTHING unexpected — ack frames,
 * other event types, truncated JSON, a payload without a cwd. The reaper
 * reads an endless untrusted stream; a line it cannot understand is a line
 * to skip, never a reason to crash out of the loop.
 */
export function closedWorkspaceCwd(line: string): string | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof event !== "object" || event === null) return null;

  const { type, payload } = event as { type?: unknown; payload?: unknown };
  if (type !== "workspace.closed") return null;
  if (typeof payload !== "object" || payload === null) return null;

  const { cwd } = payload as { cwd?: unknown };
  return typeof cwd === "string" && cwd !== "" ? cwd : null;
}

/**
 * The main checkout a linked worktree belongs to, derived from the
 * worktree's `.git` FILE — or `null` when the directory is not a linked
 * worktree of an ordinary checkout.
 *
 * A linked worktree's `.git` is a one-line file,
 * `gitdir: <main>/.git/worktrees/<name>`; the shape is what identifies it.
 * A main checkout has a `.git` DIRECTORY (readFileSync throws — the caller
 * treats that as "not a worktree"), and anything whose gitdir does not end
 * in `.git/worktrees/<name>` is something exotic (a bare repo's worktree)
 * with no main checkout to run a teardown from.
 */
export function mainCheckoutFromDotGit(
  dotGitContent: string,
  worktreePath: string,
): string | null {
  const gitdirLine = /^gitdir:\s*(.+)$/m.exec(dotGitContent)?.[1];
  if (gitdirLine === undefined) return null;

  const gitdir = path.resolve(worktreePath, gitdirLine.trim());
  const parts = gitdir.split(path.sep);
  // …/<main>/.git/worktrees/<name> — exactly this tail, nothing else.
  if (parts.length < 4) return null;
  if (parts[parts.length - 2] !== "worktrees") return null;
  if (parts[parts.length - 3] !== ".git") return null;

  const main = parts.slice(0, -3).join(path.sep);
  return main === "" ? path.sep : main;
}

export type RetireOutcome =
  /** The worktree was removed and its branch deleted. */
  | "retired"
  /** Provably merged, but uncommitted changes stayed the reaper's hand. */
  | "kept-finished-but-dirty"
  /** Unfinished or detached — the silent, normal refusal. */
  | "kept"
  /** No verdict line at all — the teardown broke; somebody should look. */
  | "unrecognized";

/**
 * Reads `worktree:teardown -- --only-finished`'s verdict line out of its
 * output. The line's shape is a contract between the two scripts —
 * teardown-worktree.mts says so at the spot that prints it.
 */
export function parseRetireOutcome(output: string): RetireOutcome {
  const match = /^only-finished: (retired|kept \((finished-but-dirty|unfinished|detached)\))/m.exec(
    output,
  );
  if (match === null) return "unrecognized";
  if (match[1] === "retired") return "retired";
  return match[2] === "finished-but-dirty" ? "kept-finished-but-dirty" : "kept";
}
