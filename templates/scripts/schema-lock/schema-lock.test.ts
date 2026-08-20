import { describe, expect, test } from "vitest";

import {
  classifySchemaLock,
  parseWorktreeHeads,
  schemaPaths,
  type LockFacts,
  type SchemaHolder,
  type SchemaPathPredicate,
} from "./schema-lock.mts";

/**
 * The predicate the tests run under — nsarchive's surface, used here as a
 * REPRESENTATIVE declaration, not the module's own: the real one is the
 * repo's, in `schema-lock.config.mts`, and the module must take whatever it
 * is given (pinned by the last `schemaPaths` test below).
 */
const isSchemaPath: SchemaPathPredicate = (file) => {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("db/migrations/")) return true;
  return /^db\/[^/]+\.sql$/.test(normalized);
};

/** A holder with the boring fields filled in. */
function holder(over: Partial<SchemaHolder> = {}): SchemaHolder {
  return {
    label: "PR #200",
    branch: "feat/other",
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    files: ["db/migrations/0006_other.sql"],
    ...over,
  };
}

/** Facts for a branch that itself adds a migration. */
function facts(over: Partial<LockFacts> = {}): LockFacts {
  return {
    selfBranch: "feat/mine",
    selfHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    selfFiles: ["src/auth.ts", "db/migrations/0005_mine.sql"],
    holders: [],
    unavailableSources: [],
    ...over,
  };
}

describe("schemaPaths", () => {
  test("keeps only schema files, deduplicated, in input order", () => {
    expect(
      schemaPaths(
        ["src/auth.ts", "db/migrations/0005_a.sql", "db/roles.sql", "db/migrations/0005_a.sql"],
        isSchemaPath,
      ),
    ).toEqual(["db/migrations/0005_a.sql", "db/roles.sql"]);
  });

  test("the surface is the predicate's to define, not the module's", () => {
    // An implementation that hard-codes any path shape — the one this module
    // replaced downstream — passes every other test and fails here.
    const prismaSurface: SchemaPathPredicate = (file) => file.startsWith("prisma/");
    expect(
      schemaPaths(["prisma/schema.prisma", "db/roles.sql"], prismaSurface),
    ).toEqual(["prisma/schema.prisma"]);
  });
});

describe("classifySchemaLock", () => {
  test("a branch with no schema change passes without consulting anything", () => {
    // The point of the early exit: no network, no `gh`, no opinion about
    // other branches — and it must survive a source being unavailable.
    const verdict = classifySchemaLock(
      facts({
        selfFiles: ["src/auth.ts", "db/migrate.mts"],
        holders: [holder()],
        unavailableSources: ["open pull requests (gh unavailable)"],
      }),
      isSchemaPath,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.ownSchemaFiles).toEqual([]);
    expect(verdict.conflicts).toEqual([]);
  });

  test("a schema branch alone in the world passes", () => {
    const verdict = classifySchemaLock(
      facts({ holders: [holder({ files: ["src/auth.ts", "src/page.tsx"] })] }),
      isSchemaPath,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.conflicts).toEqual([]);
  });

  test("another branch on the schema is a conflict even with no shared file", () => {
    // 0005_mine.sql and 0006_other.sql share no path. They still collide:
    // the lock is on the surface, and the second migration to land cannot be
    // renumbered after the fact.
    const verdict = classifySchemaLock(facts({ holders: [holder()] }), isSchemaPath);

    expect(verdict.ok).toBe(false);
    expect(verdict.conflicts).toEqual([
      {
        label: "PR #200",
        branch: "feat/other",
        files: ["db/migrations/0006_other.sql"],
      },
    ]);
    expect(verdict.reason).toContain("feat/other");
    expect(verdict.reason).toContain("db/migrations/0006_other.sql");
  });

  test("the branch does not conflict with itself by name", () => {
    // Its own open PR reports the same schema files back at it.
    const verdict = classifySchemaLock(
      facts({
        holders: [
          holder({
            label: "PR #199",
            branch: "feat/mine",
            headSha: "cccccccccccccccccccccccccccccccccccccccc",
            files: ["db/migrations/0005_mine.sql"],
          }),
        ],
      }),
      isSchemaPath,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.conflicts).toEqual([]);
  });

  test("a detached checkout does not conflict with itself by head sha", () => {
    // The reviewer's worktree: detached on the PR's head, so it has no branch
    // name to be recognised by — only the sha.
    const verdict = classifySchemaLock(
      facts({
        selfBranch: null,
        selfHead: "dddddddddddddddddddddddddddddddddddddddd",
        holders: [
          holder({
            label: "PR #201",
            branch: "feat/under-review",
            headSha: "dddddddddddddddddddddddddddddddddddddddd",
          }),
        ],
      }),
      isSchemaPath,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.conflicts).toEqual([]);
  });

  test("one branch reported by two sources is named once", () => {
    const verdict = classifySchemaLock(
      facts({
        holders: [
          holder({ label: "PR #200", branch: "feat/other" }),
          holder({
            label: "worktree ../repo-other",
            branch: "feat/other",
          }),
        ],
      }),
      isSchemaPath,
    );

    expect(verdict.conflicts).toHaveLength(1);
    expect(verdict.conflicts[0].label).toBe("PR #200");
  });

  test("two unnamed holders are never merged into one", () => {
    const verdict = classifySchemaLock(
      facts({
        holders: [
          holder({ label: "worktree ../a", branch: null, headSha: null }),
          holder({ label: "worktree ../b", branch: null, headSha: null }),
        ],
      }),
      isSchemaPath,
    );

    expect(verdict.conflicts.map((conflict) => conflict.label)).toEqual([
      "worktree ../a",
      "worktree ../b",
    ]);
  });

  test("an unavailable source is red, not a clean bill of health", () => {
    // The whole reason this is fail-closed: "gh is broken" and "nobody else
    // holds the schema" must never print the same verdict.
    const verdict = classifySchemaLock(
      facts({ unavailableSources: ["open pull requests (gh unavailable)"] }),
      isSchemaPath,
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("DID NOT RUN");
    expect(verdict.conflicts).toEqual([]);
  });

  test("a real conflict outranks an unavailable source in the message", () => {
    const verdict = classifySchemaLock(
      facts({
        holders: [holder()],
        unavailableSources: ["open pull requests (gh unavailable)"],
      }),
      isSchemaPath,
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("feat/other");
    expect(verdict.reason).not.toContain("DID NOT RUN");
  });
});

describe("parseWorktreeHeads", () => {
  // Verbatim shape of `git worktree list --porcelain` under the reviewer
  // protocol: the author's checkout on a branch, the reviewer's detached on
  // the same commit. The `HEAD` line sits directly above the `branch` line.
  const PORCELAIN = [
    "worktree /work/repo",
    "HEAD 3e5f53ca3692d334e208c0d8eff4e97f3d81ebf2",
    "branch refs/heads/feat/global-search",
    "",
    "worktree /work/repo-wt-review",
    "HEAD 3e5f53ca3692d334e208c0d8eff4e97f3d81ebf2",
    "detached",
    "",
  ].join("\n");

  test("reads the head sha of every entry, branch or not", () => {
    expect(parseWorktreeHeads(PORCELAIN)).toEqual([
      {
        path: "/work/repo",
        branch: "feat/global-search",
        headSha: "3e5f53ca3692d334e208c0d8eff4e97f3d81ebf2",
      },
      {
        path: "/work/repo-wt-review",
        branch: null,
        headSha: "3e5f53ca3692d334e208c0d8eff4e97f3d81ebf2",
      },
    ]);
  });

  test("keeps each sha with its own entry", () => {
    // A parser that scans the whole text for a sha, rather than per entry,
    // passes the test above and fails here.
    const heads = parseWorktreeHeads(
      [
        "worktree /repo",
        "HEAD 1111111111111111111111111111111111111111",
        "branch refs/heads/master",
        "",
        "worktree /repo-wt-a",
        "HEAD 2222222222222222222222222222222222222222",
        "branch refs/heads/feat/a",
        "",
      ].join("\n"),
    );

    expect(heads.map((head) => head.headSha)).toEqual([
      "1111111111111111111111111111111111111111",
      "2222222222222222222222222222222222222222",
    ]);
  });

  test("a bare entry reports neither a branch nor a head", () => {
    const heads = parseWorktreeHeads(["worktree /repo.git", "bare", ""].join("\n"));

    expect(heads).toEqual([{ path: "/repo.git", branch: null, headSha: null }]);
  });

  test("the reviewer's detached checkout is not a conflict with the branch it reviews", () => {
    // The whole bug, end to end (nsarchive#135): both worktrees sit on one
    // commit, so the review of a schema-touching branch used to report that
    // branch as conflicting with itself. Detached, `selfBranch` is null —
    // the sha is the only identity left, and it has to survive the parse to
    // be used.
    const holders: SchemaHolder[] = parseWorktreeHeads(PORCELAIN).map((head) => ({
      label: `worktree ${head.path}`,
      branch: head.branch,
      headSha: head.headSha,
      files: ["db/migrations/0005_mine.sql"],
    }));

    const verdict = classifySchemaLock(
      facts({
        selfBranch: null,
        selfHead: "3e5f53ca3692d334e208c0d8eff4e97f3d81ebf2",
        holders,
      }),
      isSchemaPath,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.conflicts).toEqual([]);
  });
});
