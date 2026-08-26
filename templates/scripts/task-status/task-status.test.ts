// Tests for `.agents/task-status.sh` — the cmux sidebar pill for task
// workspaces (two live incidents).
//
// The script's whole job is to talk to a `cmux` binary, so every test here
// puts a FAKE cmux first on PATH: a shell script that appends its own argv to
// a log file and exits 0. What the tests assert on is that log — the exact
// command lines the real cmux would have received.
//
// TMPDIR is redirected per test because the script derives its throttle cache
// from it; a shared /tmp would leak state between tests and, worse, between a
// test run and a real session.
//
// The real node's directory is on the test PATH because `stop` shells out to
// `task-status-stop.mjs`. Its own decision logic is tested directly in
// `task-status-stop.test.ts`; what is pinned HERE is that the shell turns each
// of that file's three answers into the right pill.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, 'task-status.sh');
const WORKSPACE = 'TEST-WORKSPACE-ID';
const NODE_DIR = dirname(process.execPath);

let sandbox: string;
let binDir: string;
let cmuxLog: string;
let cacheFile: string;

/** Run the script with a controlled environment. Returns its exit status. */
function run(state: string, env: Record<string, string | undefined> = {}, input = ''): number {
	try {
		execFileSync('/bin/sh', [SCRIPT, state], {
			env: {
				PATH: `${binDir}:${NODE_DIR}:/usr/bin:/bin`,
				TMPDIR: sandbox,
				CMUX_WORKSPACE_ID: WORKSPACE,
				CMUX_LOG: cmuxLog,
				...env,
			},
			input,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return 0;
	} catch (e) {
		return (e as { status?: number }).status ?? 1;
	}
}

/** Every command line the fake cmux received, in order. */
function cmuxCalls(): string[] {
	if (!existsSync(cmuxLog)) return [];
	return readFileSync(cmuxLog, 'utf8').split('\n').filter(Boolean);
}

function calls(): string {
	return cmuxCalls().join('\n');
}

/** Seed the throttle cache: `<state> <written-at> <turn-start>`. */
function seedCache(state: string, writtenAt: number, turnStart: number): void {
	writeFileSync(cacheFile, `${state} ${writtenAt} ${turnStart}\n`);
}

const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), 'task-status-'));
	binDir = join(sandbox, 'bin');
	mkdirSync(binDir);
	cmuxLog = join(sandbox, 'cmux.log');
	cacheFile = join(sandbox, `cmux-task-status-${WORKSPACE}`);
	const fake = join(binDir, 'cmux');
	writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CMUX_LOG"\nexit 0\n');
	chmodSync(fake, 0o755);
});

describe('task-status.sh — the five pills', () => {
	it('writes a "Working" pill under the `task` key, never `claude_code`', () => {
		expect(run('working')).toBe(0);
		expect(calls()).toContain('set-status task Working');
		expect(calls()).toContain(`--workspace ${WORKSPACE}`);
		expect(calls()).not.toContain('claude_code');
	});

	it('leaves the lane on auto while working, so cmux keeps inferring `review`', () => {
		run('working');
		expect(calls()).toContain('workspace status set auto');
	});

	// The half of the incident that was reported as "stayed quiet when I was needed":
	// this is what PermissionRequest and the AskUserQuestion/ExitPlanMode
	// matcher write.
	it('writes a "Waiting for you" pill and pins the needs-attention lane', () => {
		expect(run('blocked')).toBe(0);
		expect(calls()).toContain('set-status task Waiting for you');
		expect(calls()).toContain('workspace status set needs-attention');
	});

	it('clears the pill and unpins the lane', () => {
		expect(run('clear')).toBe(0);
		expect(calls()).toContain('clear-status task');
		expect(calls()).toContain('workspace status set auto');
	});
});

describe('task-status.sh — resolving `stop`', () => {
	// The other half of the incident, and the reported failure that matters most: a
	// finished report must NOT demand attention.
	it('a finished turn is neutral and does NOT pin needs-attention', () => {
		expect(run('stop', {}, JSON.stringify({ last_assistant_message: 'Done. PR is up.' }))).toBe(0);
		expect(calls()).toContain('set-status task Finished');
		expect(calls()).toContain('workspace status set auto');
		expect(calls()).not.toContain('needs-attention');
	});

	it('a turn that ended on a question goes amber and floats', () => {
		expect(run('stop', {}, JSON.stringify({ last_assistant_message: 'Report.\n\nWhich one?' }))).toBe(0);
		expect(calls()).toContain('set-status task Asked you a question');
		expect(calls()).toContain('workspace status set needs-attention');
	});

	it('a turn with background work still running says so, quietly', () => {
		const payload = JSON.stringify({ last_assistant_message: 'Kicked off.', background_tasks: [{ id: 'a' }] });
		expect(run('stop', {}, payload)).toBe(0);
		expect(calls()).toContain('set-status task Background work');
		expect(calls()).toContain('workspace status set auto');
		expect(calls()).not.toContain('needs-attention');
	});

	it('falls back to Finished when the payload is garbage', () => {
		expect(run('stop', {}, 'not json')).toBe(0);
		expect(calls()).toContain('set-status task Finished');
	});

	// Documented degradation, pinned: no node means no prose-question state,
	// never a crash and never a wrong amber.
	it('falls back to Finished when node is not on PATH', () => {
		expect(run('stop', { PATH: `${binDir}:/usr/bin:/bin` }, '{"last_assistant_message":"Which one?"}')).toBe(0);
		expect(calls()).toContain('set-status task Finished');
		expect(calls()).not.toContain('Asked you a question');
	});
});

describe('task-status.sh — the turn clock', () => {
	it('shows no number under a minute', () => {
		run('prompt');
		expect(calls()).toContain('set-status task Working ');
		expect(calls()).not.toMatch(/Working \d/);
	});

	it('shows whole minutes once the turn passes one', () => {
		seedCache('blocked', 0, nowSec() - 185);
		run('working');
		expect(calls()).toContain('set-status task Working 3m');
	});

	it('shows hours and minutes on a long turn', () => {
		seedCache('blocked', 0, nowSec() - (3600 + 300));
		run('working');
		expect(calls()).toContain('set-status task Working 1h 5m');
	});

	// The mutation-killer for the clock: `prompt` must RESET it, not inherit
	// the previous turn's start. A version that only writes the pill and leaves
	// turn_start alone passes every other test here and shows a stale
	// "Working 9m" one second into a fresh turn.
	it('`prompt` resets the clock rather than inheriting the last turn', () => {
		seedCache('done', 0, nowSec() - 3600);
		run('prompt');
		expect(calls()).not.toMatch(/Working \d/);
		const [, , turnStart] = readFileSync(cacheFile, 'utf8').trim().split(' ');
		expect(nowSec() - Number(turnStart)).toBeLessThan(5);
	});

	it('shows no number when no turn start is known', () => {
		run('working');
		expect(calls()).not.toMatch(/Working \d/);
	});

	// No clock on any other state — a frozen timer reads as a stuck pill.
	it('never puts a number on a non-working pill', () => {
		seedCache('working', 0, nowSec() - 600);
		run('blocked');
		expect(calls()).toContain('set-status task Waiting for you');
		expect(calls()).not.toMatch(/\d+m/);
	});
});

describe('task-status.sh — throttling and self-healing', () => {
	it('throttles an UNCHANGED value: the second assertion writes nothing', () => {
		run('working');
		const first = cmuxCalls().length;
		expect(first).toBeGreaterThan(0);
		run('working');
		expect(cmuxCalls().length).toBe(first);
	});

	// The mutation-killer. A throttle keyed on "did we write recently" instead
	// of "did we write THIS value" passes the test above and fails here — and
	// it is the failure that matters: answering a permission prompt has to flip
	// the pill back to Working on the very next tool call, not up to ten
	// seconds later.
	it('never throttles a state CHANGE', () => {
		run('blocked');
		const afterBlocked = cmuxCalls().length;
		run('working');
		expect(cmuxCalls().length).toBeGreaterThan(afterBlocked);
		expect(calls()).toContain('set-status task Working');
	});

	// `prompt` is exempt because it resets the clock; throttling it would leave
	// a stale elapsed number standing into a fresh turn.
	it('never throttles `prompt`, even straight after a Working write', () => {
		run('working');
		const first = cmuxCalls().length;
		run('prompt');
		expect(cmuxCalls().length).toBeGreaterThan(first);
	});

	it('re-asserts an unchanged value once the throttle window has passed', () => {
		run('working');
		const first = cmuxCalls().length;
		// Age the cache by rewriting its timestamp — the real format, so this
		// also pins that the script can read back what it wrote.
		const [state] = readFileSync(cacheFile, 'utf8').trim().split(' ');
		expect(state).toBe('working');
		seedCache('working', nowSec() - 3600, 0);
		run('working');
		expect(cmuxCalls().length).toBeGreaterThan(first);
	});

	it('survives a corrupt cache by re-asserting instead of failing', () => {
		writeFileSync(cacheFile, 'not-a-record\n');
		expect(run('working')).toBe(0);
		expect(calls()).toContain('set-status task Working');
	});

	// A two-field record is what the earlier version wrote. Reading one must
	// not throw and must not invent an elapsed time.
	it('reads a cache record written by the previous version', () => {
		writeFileSync(cacheFile, `working ${nowSec() - 3600}\n`);
		expect(run('working')).toBe(0);
		expect(calls()).toContain('set-status task Working');
		expect(calls()).not.toMatch(/Working \d/);
	});
});

describe('task-status.sh — never break the agent it reports on', () => {
	it('is a silent no-op outside cmux (no CMUX_WORKSPACE_ID)', () => {
		expect(run('working', { CMUX_WORKSPACE_ID: undefined })).toBe(0);
		expect(cmuxCalls()).toEqual([]);
		expect(existsSync(cacheFile)).toBe(false);
	});

	it('is a silent no-op when cmux is not on PATH', () => {
		expect(run('working', { PATH: '/usr/bin:/bin' })).toBe(0);
		expect(cmuxCalls()).toEqual([]);
	});

	// THE load-bearing exit-code test. A PreToolUse hook that exits 2 BLOCKS
	// the tool call, so a misconfigured pill would freeze the agent instead of
	// merely mis-reporting it — observed for real while writing the fix, when a
	// syntax error in this script made every tool call fail.
	it('exits 64 and never 2 on an unknown state', () => {
		expect(run('bogus')).toBe(64);
		expect(cmuxCalls()).toEqual([]);
	});

	it('exits 64 and never 2 with no argument at all', () => {
		expect(run('')).toBe(64);
	});

	it('does not let a failing cmux fail the hook', () => {
		const fake = join(binDir, 'cmux');
		writeFileSync(fake, '#!/bin/sh\nexit 7\n');
		chmodSync(fake, 0o755);
		expect(run('working')).toBe(0);
		expect(run('stop', {}, '{"last_assistant_message":"Which one?"}')).toBe(0);
	});
});
