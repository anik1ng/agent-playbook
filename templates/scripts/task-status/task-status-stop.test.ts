// Tests for `.agents/task-status-stop.mjs` — the half of the task pill that
// has to read a `Stop` hook payload and decide between three states. It is a
// separate file from the shell script precisely so this decision can be
// tested directly, without a fake cmux in the way.
//
// The payload field names asserted here are not guesses. A live `claude -p`
// run against a logging hook printed the Stop payload's keys
// [verified-by-execution, Claude Code 2.1.241, 2026-08-24]:
//
//   session_id, transcript_path, cwd, prompt_id, permission_mode,
//   hook_event_name, stop_hook_active, last_assistant_message,
//   background_tasks, session_crons

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backgroundCount, finalText, isQuestion, resolveState } from './task-status-stop.mjs';

const SCRIPT = resolve(import.meta.dirname, 'task-status-stop.mjs');

/** Run the resolver as the shell script does: payload on stdin, word on stdout. */
function runResolver(payload: string): string {
	return execFileSync(process.execPath, [SCRIPT], { input: payload, encoding: 'utf8' });
}

describe('isQuestion', () => {
	it('is true for a trailing `?` on the last non-empty line', () => {
		expect(isQuestion('Here is the plan.\n\nWhich one do you want?')).toBe(true);
	});

	it('sees through trailing markdown emphasis', () => {
		expect(isQuestion('Report.\n\n**Which one?**')).toBe(true);
		expect(isQuestion('Report.\n\n_Which one?_')).toBe(true);
		expect(isQuestion('Report.\n\n`Which one?`')).toBe(true);
	});

	it('ignores trailing blank lines', () => {
		expect(isQuestion('Which one?\n\n   \n')).toBe(true);
	});

	it('is false for a finished report', () => {
		expect(isQuestion('Done. Tests pass, PR is up.')).toBe(false);
	});

	// The decided compromise, pinned so nobody "fixes" it by accident: only the
	// LAST line counts. Widening this to the final paragraph is what makes a
	// finished report shout, which is the bug this module exists to fix.
	it('is false when the question is not the last line', () => {
		expect(isQuestion('Anything else?\nRunning the gate now.')).toBe(false);
	});

	it('is false for an empty or absent message', () => {
		expect(isQuestion('')).toBe(false);
		expect(isQuestion(undefined)).toBe(false);
		expect(isQuestion(null)).toBe(false);
	});
});

describe('finalText', () => {
	it('passes a string through', () => {
		expect(finalText('hello')).toBe('hello');
	});

	// Liberal on input so a future payload shape degrades to "no question"
	// rather than throwing inside a hook.
	it('joins a content-block array and ignores non-text blocks', () => {
		expect(finalText([{ text: 'a' }, { type: 'image' }, { text: 'b?' }])).toBe('a\n\nb?');
		expect(isQuestion([{ text: 'Which one?' }])).toBe(true);
	});

	it('is empty for anything else', () => {
		expect(finalText({ nope: 1 })).toBe('');
		expect(finalText(42)).toBe('');
	});
});

describe('backgroundCount', () => {
	it('counts an array', () => {
		expect(backgroundCount([{ id: 'a' }, { id: 'b' }])).toBe(2);
		expect(backgroundCount([])).toBe(0);
	});

	it('accepts a number or an object rather than guessing zero', () => {
		expect(backgroundCount(3)).toBe(3);
		expect(backgroundCount({ a: {}, b: {} })).toBe(2);
	});

	it('reads anything unrecognised as none — the quiet direction', () => {
		expect(backgroundCount(undefined)).toBe(0);
		expect(backgroundCount(null)).toBe(0);
		expect(backgroundCount('two')).toBe(0);
		expect(backgroundCount(Number.NaN)).toBe(0);
	});
});

describe('resolveState', () => {
	it('is `done` for a finished turn', () => {
		expect(resolveState({ last_assistant_message: 'All set.' })).toBe('done');
	});

	it('is `asked` for a question', () => {
		expect(resolveState({ last_assistant_message: 'Which one?' })).toBe('asked');
	});

	it('is `background` when work is still in flight', () => {
		expect(resolveState({ last_assistant_message: 'Kicked off.', background_tasks: [{ id: 'a' }] })).toBe(
			'background'
		);
	});

	// The mutation-killer for the precedence decision. Swapping the two checks
	// still passes every test above and fails only here — and it is the failure
	// that matters: a turn that asked something needs the human whether or not
	// a build is also running.
	it('lets a question outrank running background work', () => {
		expect(resolveState({ last_assistant_message: 'Which one?', background_tasks: [{ id: 'a' }] })).toBe('asked');
	});

	it('is `done` for an empty payload', () => {
		expect(resolveState({})).toBe('done');
	});
});

describe('run as a script', () => {
	it('prints the resolved word and nothing else', () => {
		expect(runResolver('{"last_assistant_message":"Which one?"}')).toBe('asked');
		expect(runResolver('{"last_assistant_message":"Done."}')).toBe('done');
		expect(runResolver('{"background_tasks":[{"id":"a"}]}')).toBe('background');
	});

	// A hook that throws on a payload it does not recognise is a hook that
	// blocks the agent. Unparsable input is not evidence of a question.
	it('degrades to `done` on garbage instead of failing', () => {
		expect(runResolver('not json at all')).toBe('done');
		expect(runResolver('')).toBe('done');
	});

	// Guards the `pathToFileURL(resolve(argv[1]))` check: invoked through a
	// RELATIVE path — which is how `task-status.sh` calls it, via `dirname
	// "$0"` — main() must still run. A naive `file://${argv[1]}` comparison
	// silently prints nothing here, and the pill would read "Finished" forever
	// with nothing looking broken.
	it('runs when invoked through a relative path', () => {
		const out = execFileSync(process.execPath, ['.agents/task-status-stop.mjs'], {
			cwd: resolve(import.meta.dirname, '..'),
			input: '{"last_assistant_message":"Which one?"}',
			encoding: 'utf8',
		});
		expect(out).toBe('asked');
	});
});
