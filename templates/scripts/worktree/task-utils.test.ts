import { describe, expect, test } from "vitest";

import {
  DEFAULT_AGENT_COMMAND,
  agentLaunchCommand,
  buildLayout,
  findCallerGroup,
  findWorkspace,
  resolveTaskWorkspace,
  taskNameFromWorktreePath,
  validateTaskName,
  workspaceRefFromAck,
  worktreePathFor,
  type ListedWorkspace,
} from "./task-utils.mts";

describe("validateTaskName", () => {
  test("accepts an ordinary handle", () => {
    for (const name of ["orphan-links", "wt2", "fix.9", "a"]) {
      expect(validateTaskName(name)).toBeNull();
    }
  });

  test("rejects anything that could escape the sibling convention", () => {
    // A name becomes a directory name. `..` or a separator would put the
    // worktree somewhere `--sweep` will never look — or somewhere worse.
    for (const name of ["..", ".", "a/b", "a\\b", "../evil", ""]) {
      expect(validateTaskName(name)).not.toBeNull();
    }
  });

  test("says WHICH rule a bad name broke", () => {
    // The catch-all character class would reject all of these anyway; these
    // checks exist so the message names the actual problem, and a message
    // that degrades to "characters outside [...]" is a regression the
    // previous test cannot see.
    expect(validateTaskName("a/b")).toContain("path separator");
    expect(validateTaskName("--force")).toContain("starts with a dash");
    expect(validateTaskName("")).toContain("empty");
  });

  test("rejects spaces and quotes", () => {
    for (const name of ["my task", "a'b", 'a"b', "a;b", "a$b"]) {
      expect(validateTaskName(name)).not.toBeNull();
    }
  });
});

describe("worktreePathFor", () => {
  test("is a SIBLING of the main checkout, prefixed with the repo's dir name", () => {
    expect(worktreePathFor("/Users/x/Projects/TS/myrepo", "probe")).toBe(
      "/Users/x/Projects/TS/myrepo-wt-probe",
    );
  });

  test("derives the prefix from the checkout, not from a hardcoded name", () => {
    // The template ships repo-agnostic: whatever the main checkout's
    // directory is called becomes the prefix.
    expect(worktreePathFor("/srv/another-name", "x")).toBe(
      "/srv/another-name-wt-x",
    );
  });

  test("does not nest inside the main checkout", () => {
    // The nesting mistake is invisible until `--sweep` reports nothing and
    // git starts tracking the worktree as untracked files of the parent.
    const target = worktreePathFor("/Users/x/repo", "probe");
    expect(target.startsWith("/Users/x/repo/")).toBe(false);
  });
});

describe("taskNameFromWorktreePath", () => {
  test("inverts worktreePathFor", () => {
    const main = "/Users/x/Projects/TS/myrepo";
    expect(
      taskNameFromWorktreePath(main, worktreePathFor(main, "probe")),
    ).toBe("probe");
  });

  test("answers null for the main checkout itself and for unrelated siblings", () => {
    const main = "/Users/x/Projects/TS/myrepo";
    expect(taskNameFromWorktreePath(main, main)).toBeNull();
    expect(taskNameFromWorktreePath(main, "/Users/x/Projects/TS/other-dir")).toBeNull();
  });

  test("answers null for a worktree parked OUTSIDE the sibling convention", () => {
    // A `-wt-` directory elsewhere on disk is not ours to name: retiring by a
    // guessed name would aim task:finish at whatever happens to be at
    // `<sibling>/<repo>-wt-<name>` instead of the directory the caller is in.
    const main = "/Users/x/Projects/TS/myrepo";
    expect(
      taskNameFromWorktreePath(main, "/Users/x/elsewhere/myrepo-wt-probe"),
    ).toBeNull();
  });

  test("answers null when the suffix is not a valid task name", () => {
    // worktreePathFor never creates these, so whatever made the directory
    // was not task:start — the degenerate "strip the prefix" implementation
    // would happily hand `--force` onwards as a name.
    const main = "/Users/x/myrepo";
    expect(taskNameFromWorktreePath(main, "/Users/x/myrepo-wt---force")).toBeNull();
    expect(taskNameFromWorktreePath(main, "/Users/x/myrepo-wt-")).toBeNull();
  });
});

describe("findWorkspace", () => {
  const workspaces: ListedWorkspace[] = [
    { ref: "workspace:1", custom_title: "Group 1", title: "Group 1" },
    { ref: "workspace:2", custom_title: null, title: "myrepo" },
    { ref: "workspace:11", custom_title: "probe", title: "probe" },
  ];

  test("finds one by its custom title", () => {
    expect(findWorkspace(workspaces, "probe")).toEqual({
      kind: "one",
      ref: "workspace:11",
    });
  });

  test("matches a workspace that was never given a custom name", () => {
    expect(findWorkspace(workspaces, "myrepo")).toEqual({
      kind: "one",
      ref: "workspace:2",
    });
  });

  test("reports none when nothing matches", () => {
    expect(findWorkspace(workspaces, "absent")).toEqual({ kind: "none" });
  });

  test("reports AMBIGUOUS rather than picking one", () => {
    // cmux does not refuse a duplicate name and does not reuse the existing
    // workspace — it creates a second one. Picking either here would close
    // the wrong session.
    const duplicated = [
      ...workspaces,
      { ref: "workspace:12", custom_title: "probe", title: "probe" },
    ];
    expect(findWorkspace(duplicated, "probe")).toEqual({
      kind: "ambiguous",
      refs: ["workspace:11", "workspace:12"],
    });
  });
});

describe("resolveTaskWorkspace", () => {
  const worktree = "/Users/x/myrepo-wt-9";
  const workspaces: ListedWorkspace[] = [
    { ref: "workspace:1", title: "myrepo", current_directory: "/Users/x/myrepo" },
    { ref: "workspace:20", title: "do #9 loop guard", current_directory: worktree },
  ];

  test("falls back to the cwd when no title matches — the renamed-workspace case", () => {
    // The bug this pins: a task workspace renamed to "do #9 loop guard" was
    // unfindable by its task name "9", so the teardown ran and the workspace
    // stayed open. The cwd is the key cmux itself uses.
    expect(resolveTaskWorkspace(workspaces, "9", worktree)).toEqual({
      kind: "one",
      ref: "workspace:20",
    });
  });

  test("prefers the title match when there is one", () => {
    const titled = [
      ...workspaces,
      { ref: "workspace:30", title: "9", current_directory: "/somewhere/else" },
    ];
    expect(resolveTaskWorkspace(titled, "9", worktree)).toEqual({
      kind: "one",
      ref: "workspace:30",
    });
  });

  test("matches a workspace whose cwd is a SUBDIRECTORY of the worktree", () => {
    // A pane that cd'd into src/ still belongs to the task.
    const deep: ListedWorkspace[] = [
      { ref: "workspace:2", title: "renamed", current_directory: `${worktree}/src` },
    ];
    expect(resolveTaskWorkspace(deep, "9", worktree)).toEqual({
      kind: "one",
      ref: "workspace:2",
    });
  });

  test("does NOT rescue an ambiguous title match via cwd", () => {
    // Two workspaces claiming one name is a stop, not a tie to break.
    const duplicated = [
      ...workspaces,
      { ref: "workspace:31", title: "9", current_directory: null },
      { ref: "workspace:32", title: "9", current_directory: worktree },
    ];
    expect(resolveTaskWorkspace(duplicated, "9", worktree)).toEqual({
      kind: "ambiguous",
      refs: ["workspace:31", "workspace:32"],
    });
  });

  test("reports cwd-ambiguity instead of closing one of two", () => {
    const doubled = [
      ...workspaces,
      { ref: "workspace:21", title: "also renamed", current_directory: worktree },
    ];
    expect(resolveTaskWorkspace(doubled, "9", worktree)).toEqual({
      kind: "ambiguous",
      refs: ["workspace:20", "workspace:21"],
    });
  });

  test("reports none without a worktree path to compare against", () => {
    expect(resolveTaskWorkspace(workspaces, "9", null)).toEqual({ kind: "none" });
  });

  test("never cwd-matches the main checkout's workspace", () => {
    // "/Users/x/myrepo" is not inside "/Users/x/myrepo-wt-9" — the
    // string-prefix implementation gets this wrong in the other direction:
    // a worktree path that PREFIXES another directory's name.
    expect(
      resolveTaskWorkspace(
        [{ ref: "workspace:5", title: "x", current_directory: "/Users/x/myrepo-wt-99" }],
        "9",
        worktree,
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("findCallerGroup", () => {
  const groups = [
    {
      ref: "workspace_group:1",
      member_workspace_refs: ["workspace:1", "workspace:2"],
    },
    { ref: "workspace_group:2", member_workspace_refs: ["workspace:9"] },
  ];

  test("finds the group holding the caller", () => {
    expect(findCallerGroup(groups, "workspace:2")).toBe("workspace_group:1");
  });

  test("returns null for a caller in no group", () => {
    // An ungrouped caller must fall back to cmux's default placement, not to
    // whatever group happens to be listed first.
    expect(findCallerGroup(groups, "workspace:42")).toBeNull();
  });

  test("returns null when cmux could not name the caller", () => {
    expect(findCallerGroup(groups, null)).toBeNull();
  });

  test("tolerates a group with no member list", () => {
    expect(
      findCallerGroup([{ ref: "workspace_group:3" }], "workspace:2"),
    ).toBeNull();
  });
});

describe("workspaceRefFromAck", () => {
  test("takes the ref out of what cmux actually answers", () => {
    // The whole point: `workspace create` answers `OK workspace:22`, and
    // CMUX_QUIET=1 does not strip that prefix. Passing the ack back as a
    // handle is refused ("Invalid workspace handle"), which is how a reorder
    // that looked right silently did nothing.
    expect(workspaceRefFromAck("OK workspace:22")).toBe("workspace:22");
  });

  test("survives an ack that has already lost the prefix", () => {
    expect(workspaceRefFromAck("workspace:1")).toBe("workspace:1");
  });

  test("finds the ref in a wordier acknowledgement", () => {
    // Other cmux verbs acknowledge differently (`reorder-workspace
    // --dry-run` answers `OK plan workspace=… window=… index=…`), which is
    // why this matches the ref's syntax rather than trimming a known prefix.
    expect(
      workspaceRefFromAck("OK plan workspace=workspace:22 window=window:1"),
    ).toBe("workspace:22");
  });

  test("answers null when there is no ref to find", () => {
    // The degenerate "strip the first two characters" implementation passes
    // every case above and fails these: a caller that gets a non-ref back
    // hands cmux garbage instead of skipping the placement.
    expect(workspaceRefFromAck(null)).toBeNull();
    expect(workspaceRefFromAck("")).toBeNull();
    expect(workspaceRefFromAck("Error: cmux is not running")).toBeNull();
  });

  test("does not mistake a GROUP ref for a workspace ref", () => {
    // `workspace_group:2` contains the word but is a different handle space —
    // reordering a group where a workspace was meant moves the wrong thing.
    expect(workspaceRefFromAck("OK workspace_group:2")).toBeNull();
  });
});

describe("buildLayout", () => {
  test("opens ONE pane and runs the agent in it", () => {
    const layout = JSON.parse(buildLayout("claude")) as {
      pane?: { surfaces: { type: string; command?: string }[] };
      children?: unknown[];
    };

    // The `children` assertion is the one that matters: asserting only "the
    // agent is somewhere" stays green for the old agent + empty-shell split
    // coming back. This test replaced the one that pinned that split.
    expect(layout.children).toBeUndefined();
    expect(layout.pane?.surfaces).toHaveLength(1);
    expect(layout.pane?.surfaces[0]).toEqual({ type: "terminal", command: "claude" });
  });

  test("carries the agent command it is given, not a hardcoded one", () => {
    expect(buildLayout("agy")).toContain("agy");
    expect(buildLayout("agy")).not.toContain(DEFAULT_AGENT_COMMAND);
  });
});

describe("agentLaunchCommand", () => {
  test("no prompt → the bare agent command, untouched", () => {
    expect(agentLaunchCommand("claude", "")).toBe("claude");
  });

  test("appends the prompt as ONE single-quoted shell argument", () => {
    // Unquoted, `/do 46` reaches the CLI as two arguments and the task
    // number is parsed as a file path or dropped — quoting is the fix, not
    // a nicety.
    expect(agentLaunchCommand("claude", "/do 46")).toBe("claude '/do 46'");
  });

  test("a single quote inside the prompt cannot end the quoting", () => {
    // Naively wrapped, `don't` becomes 'don't' — the quote closes early and
    // the tail runs UNquoted in the pane's shell.
    expect(agentLaunchCommand("claude", "fix the pane that don't start")).toBe(
      "claude 'fix the pane that don'\\''t start'",
    );
  });

  test("composes with a TASK_AGENT_CMD that carries its own flags", () => {
    expect(agentLaunchCommand("agy --sandbox", "/do 46")).toBe(
      "agy --sandbox '/do 46'",
    );
  });
});
