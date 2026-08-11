/**
 * Provision a fresh git worktree so the gate runs green in it.
 *
 *   git worktree add ../<repo>-wt-<name> -b <type>/<short-name> origin/<default-branch>
 *   cd ../<repo>-wt-<name>
 *   <pkg-manager> run worktree:setup
 *
 * (`task:start` does all three in one command — this script is its
 * provisioning half, and stays runnable on its own.)
 *
 * cwd must be the worktree — this script has no arguments and no idea of
 * "the other one". Its counterpart, `worktree:teardown`, runs from the
 * MAIN checkout instead, because `git worktree remove` cannot be run from
 * inside the directory it removes. The asymmetry is that constraint, not a
 * style choice.
 *
 * Idempotent: an existing `.env` is never touched, and an install on an
 * already-installed worktree is a no-op.
 *
 * There is deliberately no per-worktree service provisioning here. If this
 * repo's tests need one (a database per worktree, say), that is a decision
 * with its own trade-offs — record it in docs/RUNBOOK.md and extend this
 * script in the same PR.
 *
 * Imports nothing but node builtins: it runs in a worktree that has no
 * `node_modules` yet.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  ALLOWED_ENV_VARS,
  envKeys,
  filterEnv,
  packageManagerFromLockfiles,
  parseWorktreeList,
} from "./worktree-utils.mts";

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// ---------------------------------------------------------------------------
// 1. Am I in a worktree, and not in the main checkout?
// ---------------------------------------------------------------------------

// The repository ROOT, not the bare cwd: running this from a subdirectory of
// a worktree is legitimate and must not read as "you are in the main one".
const here = realpathSync(git(["rev-parse", "--show-toplevel"]));
const worktrees = parseWorktreeList(
  execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }),
);
const mainCheckout = realpathSync(worktrees[0].path);
const repoName = path.basename(mainCheckout);
const pkg = packageManagerFromLockfiles(readdirSync(here));

if (here === mainCheckout) {
  fail(
    `this is the MAIN checkout (${mainCheckout}), not a worktree.\n\n` +
      "  Create one and run setup inside it:\n\n" +
      `    git worktree add ../${repoName}-wt-<name> -b <type>/<short-name> origin/<default-branch>\n` +
      `    cd ../${repoName}-wt-<name>\n` +
      `    ${pkg} run worktree:setup`,
  );
}

console.log(`worktree: ${here}`);
console.log(`main checkout: ${mainCheckout}\n`);

// ---------------------------------------------------------------------------
// 2. .env — filtered from the main checkout, or left alone if it exists.
//    Before the install: the cheap check fails first.
// ---------------------------------------------------------------------------

const envPath = path.join(here, ".env");

if (ALLOWED_ENV_VARS.length === 0) {
  // The allowlist ships empty and stays empty until the local gate actually
  // reads a variable. Nothing to copy is a fact worth one line, not a warning.
  console.log(
    "• .env not copied — the allowlist in scripts/worktree-utils.mts is empty\n" +
      "  (nothing in the local gate reads .env; add a key there the day that changes).",
  );
} else if (existsSync(envPath)) {
  console.log("• .env is already here — left untouched.");
  const present = new Set(envKeys(readFileSync(envPath, "utf8")));
  const missing = ALLOWED_ENV_VARS.filter((key) => !present.has(key));
  if (missing.length > 0) {
    // Saying "I didn't touch your .env" and stopping there turns into a
    // mysteriously red gate an hour later.
    console.log(
      `  ⚠ it assigns none of: ${missing.join(", ")} — parts of the gate that\n` +
        "    read them will fail or skip themselves. Add them, or delete .env and re-run.",
    );
  }
} else {
  const source = path.join(mainCheckout, ".env");
  if (!existsSync(source)) {
    fail(
      `no .env here, and the main checkout has none to copy from (${source}).\n` +
        "  Create THAT one first, from .env.example.",
    );
  }

  const { text, copied, skipped } = filterEnv(readFileSync(source, "utf8"));
  const missing = ALLOWED_ENV_VARS.filter((key) => !copied.includes(key));
  if (missing.length > 0) {
    fail(
      `the main checkout's .env (${source}) assigns none of: ${missing.join(", ")}.\n` +
        "  Fix it there — a worktree copied from it would fail the gate.",
    );
  }

  writeFileSync(envPath, text);
  console.log(`• .env written from ${source}`);
  console.log(`  allowlist: ${ALLOWED_ENV_VARS.join(", ")}`);
  for (const key of copied) console.log(`    copied   ${key}`);
  for (const key of skipped) console.log(`    withheld ${key}`);
}

// ---------------------------------------------------------------------------
// 3. Dependencies. (A `prepare` script re-pointing core.hooksPath is
//    harmless here: a worktree already inherits it from the shared
//    .git/config. A fresh CLONE is what starts with the pre-push hook
//    disarmed, not a worktree.)
// ---------------------------------------------------------------------------

console.log(`\n• ${pkg} install\n`);
try {
  execFileSync(pkg, ["install"], { stdio: "inherit" });
} catch {
  fail(`${pkg} install failed — its output is above.`);
}

// ---------------------------------------------------------------------------
// 4. What to run next.
// ---------------------------------------------------------------------------

console.log(
  [
    "",
    `✓ ready: ${here}`,
    "",
    "  Gate: the exact command line is in AGENTS.md → “Getting to master”.",
    "",
    `  Teardown, from ${mainCheckout}:`,
    `         ${pkg} run worktree:teardown -- ${path.basename(here)}`,
    "",
  ].join("\n"),
);
