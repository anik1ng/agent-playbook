import { describe, expect, test } from "vitest";

import {
  ALLOWED_ENV_VARS,
  classifyBranch,
  classifyDisposable,
  classifyRetirable,
  classifyReviewWorktree,
  computeOrphans,
  dropLeadingSeparators,
  envKeys,
  filterEnv,
  gcCandidates,
  isInside,
  packageManagerFromLockfiles,
  parseRetireOutcome,
  parseWorktreeList,
  reviewWorktreePr,
  type BranchFacts,
  type ListedWorktree,
  type MergedPrHead,
} from "./worktree-utils.mts";

/** A realistic main-checkout `.env`, comments and all. */
const MAIN_ENV = [
  "# PostgreSQL — the app database.",
  "DATABASE_URL=postgres://app:pw@localhost:5432/app?sslmode=disable",
  "",
  "# Migrations ONLY — a role that owns the app schema.",
  "MIGRATION_DATABASE_URL=postgres://postgres:pw@localhost:5432/app",
  "AUTH_SECRET=s3cr3t/base64==",
  "AUTH_URL=http://localhost:3000",
  "TRUSTED_PROXIES=",
  "MAIL_API_KEY=live_key",
  "MAIL_FROM=App <app@example.com>",
  "",
].join("\n");

describe("packageManagerFromLockfiles", () => {
  test("each lockfile names its manager; bun has two spellings", () => {
    expect(packageManagerFromLockfiles(["pnpm-lock.yaml", "src"])).toBe("pnpm");
    expect(packageManagerFromLockfiles(["yarn.lock"])).toBe("yarn");
    expect(packageManagerFromLockfiles(["bun.lock"])).toBe("bun");
    expect(packageManagerFromLockfiles(["bun.lockb"])).toBe("bun");
    expect(packageManagerFromLockfiles(["package-lock.json"])).toBe("npm");
  });

  test("no lockfile at all falls back to npm, not to a guess", () => {
    expect(packageManagerFromLockfiles(["package.json", "README.md"])).toBe(
      "npm",
    );
  });

  test("a similarly named file is NOT a lockfile", () => {
    // The check is exact names, not substrings: a stray backup or a nested
    // project's file mentioned in a listing must not flip the manager.
    expect(
      packageManagerFromLockfiles(["pnpm-lock.yaml.bak", "my-yarn.lock"]),
    ).toBe("npm");
  });
});

describe("dropLeadingSeparators", () => {
  test("drops the `--` pnpm forwards, so flags stay flags", () => {
    // The shipped bug: pnpm passes `run script -- --disposable /p` through
    // as ["--", "--disposable", "/p"], and parseArgs demotes everything
    // after a positional `--` to positionals — task:finish exited 1 on its
    // own documented command line.
    expect(dropLeadingSeparators(["--", "--disposable", "/p"])).toEqual([
      "--disposable",
      "/p",
    ]);
  });

  test("is a no-op for npm, which strips the separator itself", () => {
    expect(dropLeadingSeparators(["--disposable", "/p"])).toEqual([
      "--disposable",
      "/p",
    ]);
    expect(dropLeadingSeparators([])).toEqual([]);
  });

  test("drops only LEADING separators — an inner `--` keeps its meaning", () => {
    // Doubled forwarding (`pnpm run x -- -- 9`) still resolves, but a `--`
    // after real arguments is not this bug and must reach the parser.
    expect(dropLeadingSeparators(["--", "--", "9"])).toEqual(["9"]);
    expect(dropLeadingSeparators(["a", "--", "b"])).toEqual(["a", "--", "b"]);
  });
});

describe("ALLOWED_ENV_VARS", () => {
  test("never allowlists a secret-shaped key — the LIST is local, the SAFETY is not", () => {
    // This test used to pin the list to exactly [] — but the list is a
    // DECLARED LOCAL PART (UPDATE.md): a repo that filled it in, as the
    // module intends, went red on its very next sync of this Class A file
    // (nsarchive, second sync). So the assertion is on the property that is
    // NOT local: no key naming a secret or a privileged role may ever leak
    // into a worktree — a reviewer's worktree included, where another
    // vendor's model does the reading. A legitimate key that trips this
    // pattern is a naming conversation to have, not a reason to widen it.
    for (const key of ALLOWED_ENV_VARS) {
      expect(key).not.toMatch(/SECRET|KEY|TOKEN|PASSW|PRIVATE|CREDENTIAL|MIGRATION/i);
    }
  });
});

describe("filterEnv", () => {
  test("copies only the allowlisted key, withholds everything else", () => {
    const { text, copied, skipped } = filterEnv(MAIN_ENV, ["DATABASE_URL"]);

    expect(copied).toEqual(["DATABASE_URL"]);
    expect(skipped).toEqual([
      "MIGRATION_DATABASE_URL",
      "AUTH_SECRET",
      "AUTH_URL",
      "TRUSTED_PROXIES",
      "MAIL_API_KEY",
      "MAIL_FROM",
    ]);
    expect(envKeys(text)).toEqual(["DATABASE_URL"]);
    expect(text).toContain(
      "DATABASE_URL=postgres://app:pw@localhost:5432/app?sslmode=disable",
    );
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("live_key");
  });

  test("with an EMPTY allowlist, copies NOTHING", () => {
    // An explicit [], not the module default: the default is
    // ALLOWED_ENV_VARS, whose contents are a repo's local decision (see
    // above) — what this pins is the mechanism's posture when nothing has
    // been allowed yet.
    const { copied, skipped, text } = filterEnv(MAIN_ENV, []);

    expect(copied).toEqual([]);
    expect(skipped).toContain("DATABASE_URL");
    expect(envKeys(text)).toEqual([]);
  });

  test("a variable nobody has heard of does NOT leak", () => {
    // The point of an allowlist over a denylist: a key added to .env next
    // year is withheld by default, without anyone remembering to say so.
    const { text, copied, skipped } = filterEnv(
      `${MAIN_ENV}STRIPE_SECRET_KEY=sk_live_totally_new\n`,
      ["DATABASE_URL"],
    );

    expect(copied).toEqual(["DATABASE_URL"]);
    expect(skipped).toContain("STRIPE_SECRET_KEY");
    expect(text).not.toContain("sk_live_totally_new");
  });

  test("keeps a value containing '=' intact and drops the prose", () => {
    const { text } = filterEnv("# comment\nDATABASE_URL=postgres://a?b=c&d=e\n", [
      "DATABASE_URL",
    ]);

    expect(text).toContain("DATABASE_URL=postgres://a?b=c&d=e");
    expect(text).not.toContain("# comment");
  });

  test("reports nothing copied when the source misses an allowlisted key", () => {
    expect(
      filterEnv("AUTH_URL=http://localhost:3000\n", ["DATABASE_URL"]).copied,
    ).toEqual([]);
  });
});

describe("envKeys", () => {
  test("finds assignments and ignores comments and blanks", () => {
    expect(envKeys("# DATABASE_URL=commented\n\nA=1\nexport B=2\nnot a line")).toEqual(
      ["A", "B"],
    );
  });
});

describe("parseWorktreeList", () => {
  const PORCELAIN = [
    "worktree /repo",
    "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "branch refs/heads/master",
    "",
    "worktree /repo-wt-live",
    "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "branch refs/heads/feat/live",
    "",
    "worktree /repo-wt-gone",
    "HEAD cccccccccccccccccccccccccccccccccccccccc",
    "branch refs/heads/feat/gone",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");

  test("keeps the main checkout first and strips refs/heads/", () => {
    const parsed = parseWorktreeList(PORCELAIN);

    expect(parsed[0]).toEqual({
      path: "/repo",
      branch: "master",
      prunable: false,
    });
    expect(parsed.map((w) => w.branch)).toEqual([
      "master",
      "feat/live",
      "feat/gone",
    ]);
  });

  test("marks only the prunable entry prunable", () => {
    expect(parseWorktreeList(PORCELAIN).map((w) => w.prunable)).toEqual([
      false,
      false,
      true,
    ]);
  });

  test("reads a detached worktree as branchless", () => {
    const parsed = parseWorktreeList(
      "worktree /repo\nHEAD aaaa\ndetached\n\n",
    );
    expect(parsed).toEqual([
      { path: "/repo", branch: null, prunable: false },
    ]);
  });
});

describe("classifyBranch", () => {
  const HEAD = "1111111111111111111111111111111111111111";
  const OLDER = "2222222222222222222222222222222222222222";
  const UPDATED = "3333333333333333333333333333333333333333";

  /** The merged head IS the branch tip — the pre-“Update branch” shape. */
  const sameHead: MergedPrHead = { sha: HEAD, containsLocalHead: true };
  /** A merge commit from “Update branch”, containing the branch tip. */
  const ahead: MergedPrHead = { sha: UPDATED, containsLocalHead: true };
  /** A merged head the branch tip is NOT contained in — work landed after. */
  const behind: MergedPrHead = { sha: OLDER, containsLocalHead: false };
  /** Containment could not be established at all. */
  const unknown: MergedPrHead = { sha: OLDER, containsLocalHead: undefined };

  const base: BranchFacts = {
    branch: "feat/x",
    unpushedCommits: 0,
    localHead: HEAD,
    mergedPrHeads: [],
  };

  test("everything pushed → deletable, without asking GitHub", () => {
    const verdict = classifyBranch({ ...base, mergedPrHeads: undefined });

    expect(verdict.deletable).toBe(true);
    expect(verdict.reason).toContain("origin");
  });

  test("merged at exactly this head → deletable", () => {
    // The case check 1 alone can never see: a squash-merge leaves the
    // branch's own commits on no origin ref at all.
    const verdict = classifyBranch({
      ...base,
      unpushedCommits: 3,
      mergedPrHeads: [sameHead],
    });

    expect(verdict.deletable).toBe(true);
    expect(verdict.reason).toContain("merged");
  });

  test("merged AHEAD of the tip (“Update branch”) → deletable", () => {
    // The merged head is a merge commit GitHub's “Update branch” button
    // wrote, so it is not the branch tip — but it contains it, and an
    // implementation that compares SHAs for equality refuses here.
    const verdict = classifyBranch({
      ...base,
      unpushedCommits: 2,
      mergedPrHeads: [ahead],
    });

    expect(verdict.deletable).toBe(true);
    expect(verdict.reason).toContain("contains");
    expect(verdict.reason).toContain("3333333");
  });

  test("merged, but commits landed after the merge → KEPT", () => {
    // The data-loss case, and the whole reason the predicate exists: check 1
    // says "local commits", check 2 says "merged", and a disjunction without
    // the containment test would offer to delete work that exists nowhere
    // else. Commits written after the merge put the tip OUTSIDE the merged
    // head, so containment is false — exactly as equality would be.
    const verdict = classifyBranch({
      ...base,
      unpushedCommits: 1,
      mergedPrHeads: [behind],
    });

    expect(verdict.deletable).toBe(false);
    expect(verdict.reason).toContain("AFTER");
  });

  test("containment unanswerable → KEPT as a check that did not run", () => {
    // The merged head is not in the local object store and fetching it
    // failed. That is an unanswered question, not the data-loss finding —
    // it must not be reported with the "work landed AFTER" wording.
    const verdict = classifyBranch({
      ...base,
      unpushedCommits: 1,
      mergedPrHeads: [unknown],
    });

    expect(verdict.deletable).toBe(false);
    expect(verdict.reason).toContain("DID NOT RUN");
    expect(verdict.reason).not.toContain("AFTER");
  });

  test("one answerable containment outranks an unanswerable one", () => {
    const verdict = classifyBranch({
      ...base,
      unpushedCommits: 1,
      mergedPrHeads: [unknown, ahead],
    });

    expect(verdict.deletable).toBe(true);
  });

  test("gh unavailable → KEPT, and says the check did not run", () => {
    const verdict = classifyBranch({
      ...base,
      unpushedCommits: 2,
      mergedPrHeads: undefined,
    });

    expect(verdict.deletable).toBe(false);
    expect(verdict.reason).toContain("DID NOT RUN");
    // "not checked" must not be dressed up as a finding about the branch.
    expect(verdict.reason).not.toContain("no merged PR was found");
  });

  test("unpushed commits and no merged PR → KEPT", () => {
    const verdict = classifyBranch({ ...base, unpushedCommits: 4 });

    expect(verdict.deletable).toBe(false);
    expect(verdict.reason).toContain("4 commits");
  });

  test("one merged PR among several contains the head", () => {
    const verdict = classifyBranch({
      ...base,
      unpushedCommits: 2,
      mergedPrHeads: [behind, sameHead],
    });

    expect(verdict.deletable).toBe(true);
  });
});

describe("classifyRetirable", () => {
  const HEAD = "1111111111111111111111111111111111111111";
  const UPDATED = "3333333333333333333333333333333333333333";

  const merged: BranchFacts = {
    branch: "fix/x",
    unpushedCommits: 4,
    localHead: HEAD,
    mergedPrHeads: [{ sha: HEAD, containsLocalHead: true }],
  };

  test("merged PR containing the tip, clean tree → retire", () => {
    const decision = classifyRetirable({
      branch: "fix/x",
      dirty: false,
      branchFacts: merged,
    });

    expect(decision.kind).toBe("retire");
    expect(decision.reason).toContain("merged");
  });

  test("merged AHEAD of the tip (“Update branch”) → retire", () => {
    const decision = classifyRetirable({
      branch: "fix/x",
      dirty: false,
      branchFacts: {
        ...merged,
        mergedPrHeads: [{ sha: UPDATED, containsLocalHead: true }],
      },
    });

    expect(decision.kind).toBe("retire");
  });

  test("fully pushed but NO merged PR → kept, however deletable it is", () => {
    // The line between this predicate and classifyBranch, and the reason it
    // exists at all: a pushed branch whose PR is still OPEN is perfectly
    // safe to delete (origin holds every commit) and is exactly what a
    // reaper must not touch — review blockers come back to a worktree that
    // would no longer exist. An implementation that reuses classifyBranch's
    // "everything is on origin" arm retires here, and this test goes red.
    const decision = classifyRetirable({
      branch: "fix/x",
      dirty: false,
      branchFacts: { ...merged, unpushedCommits: 0, mergedPrHeads: [] },
    });

    expect(decision.kind).toBe("kept-unfinished");
    expect(decision.reason).toContain("in flight");
  });

  test("merged, but the tip is not contained → kept", () => {
    const decision = classifyRetirable({
      branch: "fix/x",
      dirty: false,
      branchFacts: {
        ...merged,
        mergedPrHeads: [{ sha: UPDATED, containsLocalHead: false }],
      },
    });

    expect(decision.kind).toBe("kept-unfinished");
  });

  test("the merged-PR check could not run → kept as unanswered, not as safe", () => {
    const decision = classifyRetirable({
      branch: "fix/x",
      dirty: false,
      branchFacts: { ...merged, mergedPrHeads: undefined },
    });

    expect(decision.kind).toBe("kept-unfinished");
    expect(decision.reason).toContain("DID NOT RUN");
  });

  test("merged but dirty → its OWN kind, so the refusal can be announced", () => {
    // The one refusal worth a notification: the human believes the task is
    // done, and the reaper left the worktree standing on purpose.
    const decision = classifyRetirable({
      branch: "fix/x",
      dirty: true,
      branchFacts: merged,
    });

    expect(decision.kind).toBe("kept-finished-but-dirty");
    expect(decision.reason).toContain("uncommitted");
  });

  test("detached → kept: a reviewer's checkout is never a finished task", () => {
    const decision = classifyRetirable({
      branch: null,
      dirty: false,
      branchFacts: null,
    });

    expect(decision.kind).toBe("kept-detached");
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

describe("gcCandidates", () => {
  const task = (path: string, branch: string | null): ListedWorktree => ({
    path,
    branch,
    prunable: false,
  });

  test("nominates the closed-but-present worktree and spares the open one", () => {
    const candidates = gcCandidates({
      worktrees: [task("/u/repo-wt-9", "fix/nine"), task("/u/repo-wt-44", "feat/redesign")],
      openDirectories: ["/u/repo", "/u/repo-wt-44"],
    });
    expect(candidates.map((worktree) => worktree.path)).toEqual(["/u/repo-wt-9"]);
  });

  test("a workspace cwd'd in a SUBDIRECTORY still guards its worktree", () => {
    expect(
      gcCandidates({
        worktrees: [task("/u/repo-wt-9", "fix/nine")],
        openDirectories: ["/u/repo-wt-9/src/deep"],
      }),
    ).toEqual([]);
  });

  test("no workspace list means NO candidates — fail closed, not wide open", () => {
    // The degenerate implementation treats "could not ask cmux" as "nothing
    // is open" and nominates every worktree on the machine.
    expect(
      gcCandidates({
        worktrees: [task("/u/repo-wt-9", "fix/nine")],
        openDirectories: null,
      }),
    ).toEqual([]);
    // An EMPTY list is the opposite answer: asked, none open.
    expect(
      gcCandidates({
        worktrees: [task("/u/repo-wt-9", "fix/nine")],
        openDirectories: [],
      }),
    ).toHaveLength(1);
  });

  test("skips detached and prunable entries", () => {
    // Detached is the reviewer's checkout; prunable has no directory to judge.
    expect(
      gcCandidates({
        worktrees: [
          task("/u/repo-wt-review", null),
          { path: "/u/repo-wt-gone", branch: "fix/gone", prunable: true },
        ],
        openDirectories: [],
      }),
    ).toEqual([]);
  });

  test("a worktree whose name PREFIXES an open cwd is still nominated", () => {
    // isInside, not startsWith: an open workspace on /u/repo-wt-99 must not
    // shield /u/repo-wt-9.
    expect(
      gcCandidates({
        worktrees: [task("/u/repo-wt-9", "fix/nine")],
        openDirectories: ["/u/repo-wt-99"],
      }),
    ).toHaveLength(1);
  });
});

describe("classifyDisposable", () => {
  test("a detached worktree is disposable", () => {
    const verdict = classifyDisposable({
      path: "/repo-wt-review-117",
      branch: null,
    });

    expect(verdict.disposable).toBe(true);
    expect(verdict.reason).toContain("detached");
  });

  test("a worktree WITH a branch is never disposable", () => {
    // The whole point of the flag: "force always" passes every other test
    // here and destroys the author's uncommitted work on this one.
    const verdict = classifyDisposable({
      path: "/repo-wt-foo",
      branch: "feat/foo",
    });

    expect(verdict.disposable).toBe(false);
    expect(verdict.reason).toContain("feat/foo");
  });

  test("the reviewer's naming does not buy a branch a pass", () => {
    // The guard is the detached HEAD, not the directory name — a branch
    // checked out in a review-shaped directory is still somebody's copy.
    expect(
      classifyDisposable({
        path: "/repo-wt-review-118",
        branch: "fix/something",
      }).disposable,
    ).toBe(false);
  });

  test("the default branch in a worktree is not disposable either", () => {
    expect(
      classifyDisposable({ path: "/repo-wt-x", branch: "master" }).disposable,
    ).toBe(false);
  });
});

describe("reviewWorktreePr", () => {
  test("reads the PR number out of a reviewer worktree's name", () => {
    expect(reviewWorktreePr("/x/myrepo-wt-review-117")).toBe(117);
    expect(reviewWorktreePr("/x/myrepo-wt-review-9/")).toBe(9);
  });

  test("an ordinary worktree carries no PR number", () => {
    expect(reviewWorktreePr("/x/myrepo-wt-feature")).toBeNull();
    expect(reviewWorktreePr("/x/myrepo-wt-review-abc")).toBeNull();
    expect(reviewWorktreePr("/x/review-117")).toBeNull();
  });

  // Not a nameless edge case: `<repo>-wt-review` is the CURRENT scheme — one
  // persistent reviewer checkout per repository, reset per PR. A sweep offers
  // to retire what this function names, so answering null here is what keeps
  // the live reviewer checkout off that list. The numbered form above is the
  // old per-PR scheme, and only its leftovers are retirable.
  test("the shared reviewer worktree is not a numbered leftover", () => {
    expect(reviewWorktreePr("/x/myrepo-wt-review")).toBeNull();
    expect(reviewWorktreePr("/x/myrepo-wt-review/")).toBeNull();
  });

  test("only the trailing segment counts", () => {
    // A parent directory that happens to be named like one must not make
    // every checkout under it look like a reviewer's.
    expect(reviewWorktreePr("/myrepo-wt-review-117/sub")).toBeNull();
  });
});

describe("classifyReviewWorktree", () => {
  test("a merged or closed PR's worktree is a leftover", () => {
    expect(classifyReviewWorktree({ pr: 117, state: "MERGED" })).toEqual({
      retirable: true,
      reason: "PR #117 is merged",
    });
    expect(classifyReviewWorktree({ pr: 12, state: "CLOSED" }).retirable).toBe(
      true,
    );
  });

  test("an open PR's worktree is left alone", () => {
    const verdict = classifyReviewWorktree({ pr: 118, state: "OPEN" });

    expect(verdict.retirable).toBe(false);
    expect(verdict.reason).toContain("still open");
  });

  test("gh unanswered is 'not checked', never 'closed'", () => {
    // Fail-closed, like classifyBranch: an unanswered question must not
    // print a deletion command for a review that may still be running.
    const verdict = classifyReviewWorktree({ pr: 118, state: undefined });

    expect(verdict.retirable).toBe(false);
    expect(verdict.reason).toContain("did not run");
  });
});

describe("computeOrphans", () => {
  const live = { path: "/repo-wt-live", branch: "feat/live", prunable: false };
  const gone = { path: "/repo-wt-gone", branch: "feat/gone", prunable: true };
  const detachedGone = { path: "/repo-wt-det", branch: null, prunable: true };

  test("a live worktree is not an orphan; a vanished one is", () => {
    const orphans = computeOrphans({
      worktrees: [live, gone],
      candidateDirs: [{ path: "/repo-wt-live", adminName: "repo-wt-live" }],
    });

    expect(orphans.prunable).toEqual([gone]);
    expect(orphans.strayDirs).toEqual([]);
    expect(orphans.branches).toEqual(["feat/gone"]);
  });

  test("a directory git no longer lists is a stray", () => {
    const orphans = computeOrphans({
      worktrees: [live],
      candidateDirs: [
        { path: "/repo-wt-live", adminName: "repo-wt-live" },
        { path: "/repo-wt-orphan", adminName: "repo-wt-orphan" },
      ],
    });

    expect(orphans.strayDirs).toEqual(["/repo-wt-orphan"]);
  });

  test("a detached vanished worktree contributes no branch", () => {
    const orphans = computeOrphans({
      worktrees: [detachedGone],
      candidateDirs: [],
    });

    expect(orphans.prunable).toEqual([detachedGone]);
    expect(orphans.branches).toEqual([]);
  });

  test("nothing anywhere is not an error", () => {
    expect(computeOrphans({ worktrees: [], candidateDirs: [] })).toEqual({
      prunable: [],
      strayDirs: [],
      branches: [],
    });
  });
});

describe("isInside", () => {
  test("a path is inside itself and inside its parent", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
  });

  test("a sibling with a shared prefix is not inside", () => {
    expect(isInside("/a/bc", "/a/b")).toBe(false);
    expect(isInside("/a", "/a/b")).toBe(false);
  });
});
