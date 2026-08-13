import { describe, expect, test } from "vitest";

import {
  closedWorkspaceCwd,
  mainCheckoutFromDotGit,
  parseRetireOutcome,
} from "./reaper-utils.mts";

describe("closedWorkspaceCwd", () => {
  test("a workspace.closed event answers its cwd", () => {
    const line = JSON.stringify({
      type: "workspace.closed",
      payload: {
        title: "autoscroll",
        custom_title: null,
        cwd: "/Users/dev/seejs-wt-autoscroll",
        workspace_id: "1493D6AB-0000-0000-0000-000000000000",
      },
    });
    expect(closedWorkspaceCwd(line)).toBe("/Users/dev/seejs-wt-autoscroll");
  });

  test("every other stream line answers null, crashing on none of them", () => {
    // The stream interleaves ack frames and other event kinds with the one
    // the reaper wants — and can hand over garbage mid-reconnect.
    const noise = [
      JSON.stringify({ type: "ack", boot_id: "D4320452", resume: {} }),
      JSON.stringify({ type: "workspace.created", payload: { cwd: "/x" } }),
      JSON.stringify({ type: "workspace.selected", payload: { cwd: "/x" } }),
      JSON.stringify({ type: "workspace.closed" }), // no payload at all
      JSON.stringify({ type: "workspace.closed", payload: { cwd: "" } }),
      JSON.stringify({ type: "workspace.closed", payload: { cwd: 42 } }),
      '{"type":"workspace.closed","payload":{"cwd":"/tru', // truncated
      "null",
      "",
    ];
    for (const line of noise) {
      expect(closedWorkspaceCwd(line)).toBeNull();
    }
  });
});

describe("mainCheckoutFromDotGit", () => {
  test("a linked worktree's gitdir names its main checkout", () => {
    expect(
      mainCheckoutFromDotGit(
        "gitdir: /Users/dev/seejs/.git/worktrees/seejs-wt-autoscroll\n",
        "/Users/dev/seejs-wt-autoscroll",
      ),
    ).toBe("/Users/dev/seejs");
  });

  test("a RELATIVE gitdir resolves against the worktree's own path", () => {
    expect(
      mainCheckoutFromDotGit(
        "gitdir: ../seejs/.git/worktrees/seejs-wt-autoscroll",
        "/Users/dev/seejs-wt-autoscroll",
      ),
    ).toBe("/Users/dev/seejs");
  });

  test("anything not shaped .git/worktrees/<name> is refused", () => {
    // A submodule's .git file points into .git/modules/ — same file shape,
    // different meaning, and no worktree teardown could act on it.
    expect(
      mainCheckoutFromDotGit(
        "gitdir: /Users/dev/app/.git/modules/vendored",
        "/Users/dev/app/vendored",
      ),
    ).toBeNull();
    expect(mainCheckoutFromDotGit("not a gitdir line", "/x")).toBeNull();
    expect(mainCheckoutFromDotGit("", "/x")).toBeNull();
  });
});

describe("parseRetireOutcome", () => {
  test("each verdict line maps to its outcome", () => {
    expect(
      parseRetireOutcome(
        "only-finished: retired — branch fix/autoscroll deleted (a PR from it was merged at 1234abc)",
      ),
    ).toBe("retired");
    expect(
      parseRetireOutcome(
        "only-finished: kept (finished-but-dirty) — merged, but the tree holds uncommitted changes",
      ),
    ).toBe("kept-finished-but-dirty");
    expect(
      parseRetireOutcome("only-finished: kept (unfinished) — no merged PR exists"),
    ).toBe("kept");
    expect(
      parseRetireOutcome("only-finished: kept (detached) — detached HEAD"),
    ).toBe("kept");
  });

  test("the verdict is found among the package manager's own chatter", () => {
    // `npm run` prefixes script output with its own banner lines.
    const output = [
      "",
      "> seejs@1.0.0 worktree:teardown",
      "> node scripts/teardown-worktree.mts --only-finished /x",
      "",
      "only-finished: retired — branch fix/x deleted (a PR from it was merged at 1234abc)",
      "",
    ].join("\n");
    expect(parseRetireOutcome(output)).toBe("retired");
  });

  test("no verdict line at all is 'unrecognized', never a silent keep", () => {
    // A teardown that crashed before judging must surface as an error —
    // mapping it to "kept" would hide every future breakage of the contract.
    expect(parseRetireOutcome("TypeError: boom\n  at judge (...)")).toBe(
      "unrecognized",
    );
    expect(parseRetireOutcome("")).toBe("unrecognized");
  });
});
