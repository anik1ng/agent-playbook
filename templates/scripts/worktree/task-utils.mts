/**
 * The decisions behind `task:start` / `task:finish`, pulled out of the
 * scripts so they can be tested without git, a workspace manager or a
 * filesystem.
 *
 * Same split as worktree-utils.mts, for the same reason: the caller gathers
 * the facts and passes them in, and the parts worth pinning are the ones that
 * decide where a directory is created and which workspace gets CLOSED.
 *
 * Imports nothing but node builtins — `task:start` runs `worktree:setup` in a
 * worktree that has no `node_modules` yet, and must itself run in one too.
 */
import path from "node:path";

/**
 * The agent the left pane starts. Overridable via TASK_AGENT_CMD because
 * this is the one thing in here that is about a vendor rather than about
 * the repo: the reviewer runs a different family on purpose (AGENTS.md →
 * "Model routing").
 */
export const DEFAULT_AGENT_COMMAND = "claude";

/**
 * Task names become a directory name and a workspace name, so they are
 * restricted to what is safe in both. A separator or `..` would let a name
 * escape the sibling convention and put a worktree anywhere on disk.
 */
export function validateTaskName(name: string): string | null {
  if (name.length === 0) return "the name is empty";
  if (name.startsWith("-")) return `“${name}” starts with a dash`;
  if (/[/\\]/.test(name)) return `“${name}” contains a path separator`;
  if (name === "." || name === "..") return `“${name}” is a path, not a name`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return `“${name}” has characters outside [A-Za-z0-9._-]`;
  }
  return null;
}

/**
 * `<parent of the main checkout>/<repo-dir-name>-wt-<name>` — always
 * absolute, always a SIBLING of the main checkout (the convention
 * `worktree:teardown --sweep` looks in; a worktree parked elsewhere is
 * invisible to it). The prefix is derived from the main checkout's own
 * directory name at runtime, so the scripts carry no hardcoded repo name.
 */
export function worktreePathFor(mainCheckout: string, name: string): string {
  const prefix = `${path.basename(mainCheckout)}-wt-`;
  return path.join(path.dirname(mainCheckout), `${prefix}${name}`);
}

/**
 * One workspace as `cmux workspace list --json` reports it.
 *
 * `title` is the field to match on: cmux always populates it — with the
 * custom name when there is one (including after `workspace rename`) and with
 * a derived name otherwise, where `custom_title` is null
 * [verified-by-execution, cmux 0.64.22, 2026-08-10]. `custom_title` is
 * declared here because the JSON carries it, not because anything reads it.
 */
export type ListedWorkspace = {
  ref: string;
  title: string;
  custom_title?: string | null;
};

export type WorkspaceMatch =
  | { kind: "one"; ref: string }
  | { kind: "none" }
  | { kind: "ambiguous"; refs: string[] };

/**
 * Find the workspace called `name`.
 *
 * "Ambiguous" is a real outcome, not defensive padding: cmux does NOT refuse
 * a second workspace with an existing name and does not reuse the old one —
 * it creates a duplicate [verified-by-execution, cmux 0.64.22, 2026-08-10].
 * So `close` must never guess which of two it was asked for, and `create`
 * must check first rather than trust cmux to.
 */
export function findWorkspace(
  workspaces: readonly ListedWorkspace[],
  name: string,
): WorkspaceMatch {
  const refs = workspaces
    .filter((workspace) => workspace.title === name)
    .map((workspace) => workspace.ref);

  if (refs.length === 0) return { kind: "none" };
  if (refs.length === 1) return { kind: "one", ref: refs[0] };
  return { kind: "ambiguous", refs };
}

/** One group as `cmux workspace-group list --json` reports it. */
export type ListedGroup = {
  ref: string;
  member_workspace_refs?: string[];
};

/**
 * The group `callerRef` belongs to, or `null`.
 *
 * Without it a new workspace lands outside the caller's group, at the bottom
 * of the sidebar — which is exactly where you do not look for it. cmux reports
 * membership only from the GROUP side; a workspace's own JSON says nothing
 * about which group holds it [verified-by-execution, cmux 0.64.22,
 * 2026-08-10], so the caller's ref has to be matched against the members.
 */
export function findCallerGroup(
  groups: readonly ListedGroup[],
  callerRef: string | null,
): string | null {
  if (callerRef === null) return null;
  const group = groups.find((candidate) =>
    (candidate.member_workspace_refs ?? []).includes(callerRef),
  );
  return group?.ref ?? null;
}

/**
 * The workspace ref inside a cmux acknowledgement line, or `null`.
 *
 * Every cmux command acknowledges on stdout with `OK <something>` — `workspace
 * create` answers `OK workspace:22` — and CMUX_QUIET=1 does NOT strip that
 * prefix: it silences the deprecation notices, nothing else
 * [verified-by-execution, cmux 0.64.22, 2026-08-14]. So the captured output of
 * a create is the whole line, and the ref half is the only part that is a
 * HANDLE: cmux refuses the rest — `Invalid workspace handle: OK workspace:22
 * (expected UUID, ref like workspace:1, or index)`. That refusal is what left
 * `auto-review.sh` parking every reviewer at the end of its group instead of
 * under its author. Here the leak was only cosmetic (a console line reading
 * `created (OK workspace:22)`), but it is the same ack and the same trap, so
 * both sides now parse rather than trust.
 *
 * Matches the ref instead of trimming a known prefix — `OK ` is one ack shape
 * among several, and the ref is the part that has a syntax.
 */
export function workspaceRefFromAck(ack: string | null): string | null {
  return ack?.match(/workspace:\d+/)?.[0] ?? null;
}

/**
 * The split the human asked for: an agent on the left, an EMPTY terminal on
 * the right. The right pane carries no `command` on purpose — it is the shell
 * you drop into to run a query or read a log while the agent works.
 *
 * Shape taken from `cmux new-workspace --help` and confirmed by creating one
 * [verified-by-execution, cmux 0.64.22, 2026-08-10]: two panes, both
 * terminals, both inheriting `--cwd`, and the left one having run its command.
 */
export function buildLayout(agentCommand: string): string {
  return JSON.stringify({
    direction: "horizontal",
    split: 0.6,
    children: [
      { pane: { surfaces: [{ type: "terminal", command: agentCommand }] } },
      { pane: { surfaces: [{ type: "terminal" }] } },
    ],
  });
}
