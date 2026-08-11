import { describe, expect, test } from "vitest";

import {
  DEFAULT_AGENT_COMMAND,
  buildLayout,
  findCallerGroup,
  findWorkspace,
  validateTaskName,
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

describe("buildLayout", () => {
  test("puts the agent in the first pane and leaves the second EMPTY", () => {
    const layout = JSON.parse(buildLayout("claude")) as {
      children: { pane: { surfaces: { type: string; command?: string }[] } }[];
    };

    expect(layout.children).toHaveLength(2);
    expect(layout.children[0].pane.surfaces[0]).toEqual({
      type: "terminal",
      command: "claude",
    });
    // The right pane is the shell you drop into while the agent works. A
    // layout that starts the agent in both panes is two agents in one
    // worktree, racing on the same files.
    expect(layout.children[1].pane.surfaces[0].command).toBeUndefined();
    expect(layout.children[1].pane.surfaces[0].type).toBe("terminal");
  });

  test("carries the agent command it is given, not a hardcoded one", () => {
    expect(buildLayout("agy")).toContain("agy");
    expect(buildLayout("agy")).not.toContain(DEFAULT_AGENT_COMMAND);
  });
});
