// Reads a Claude Code `Stop` hook payload on stdin and prints ONE word —
// `asked`, `background` or `done` — for `task-status.sh` to turn into a pill.
//
// This is a separate file rather than a `node -e` inside the shell script for
// two reasons, one of them learned the hard way: a regex containing `)` and a
// backtick inside `$(cat <<EOF ... )` breaks the shell's parse of the
// surrounding command substitution, and a shell script that fails to parse
// exits 2, which is the one exit code that BLOCKS the tool call from a
// PreToolUse hook. The other reason is that the question test below is the part
// of the fix most likely to be wrong, so it should be directly testable.
//
// NEVER exits non-zero and never writes to stdout except one of the three
// words. The caller re-checks that anyway, because a pill must not be able to
// break the agent it reports on.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ASKED = 'asked';
const BACKGROUND = 'background';
const DONE = 'done';

/**
 * The final assistant text of the turn. Documented as a string; an array of
 * content blocks is accepted too, so a future shape change degrades to "no
 * question found" rather than throwing.
 */
export function finalText(message) {
	if (typeof message === 'string') return message;
	if (Array.isArray(message)) {
		return message.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
	}
	return '';
}

/**
 * Is the agent asking the human something?
 *
 * Deliberately crude (decided live): trailing `?` on the LAST non-empty
 * line, after trimming whitespace and trailing markdown emphasis so that
 * `**Which one?**` still counts.
 *
 * Known and accepted misses: "Which one? Let me know." reads as finished, and
 * a report closing on a rhetorical question reads as asked. The wider "any line
 * in the final paragraph" rule was rejected for false-positiving on exactly the
 * finished reports this issue exists to stop from shouting, and the worst case
 * either way is a wrong pill colour.
 */
export function isQuestion(message) {
	const lines = finalText(message)
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return false;
	const last = lines[lines.length - 1];
	// Trailing emphasis, quotes and closers only — never leading ones, or
	// `> Which one?` in a blockquote would stop matching.
	const stripped = last.replace(/[\s*_~"'’”)\]]+$/, '').replace(/`+$/, '');
	return stripped.endsWith('?');
}

/**
 * How many background tasks were still in flight when the turn ended. The
 * payload's exact shape is not pinned by the docs, so every plausible one is
 * accepted; anything unrecognised counts as zero, which reads as "Finished" —
 * the quiet direction, not the shouting one.
 */
export function backgroundCount(tasks) {
	if (Array.isArray(tasks)) return tasks.length;
	if (typeof tasks === 'number') return Number.isFinite(tasks) ? tasks : 0;
	if (tasks && typeof tasks === 'object') return Object.keys(tasks).length;
	return 0;
}

/**
 * A question OUTRANKS running background work, deliberately: a turn that both
 * asked something and left a build running still needs the human first.
 * "Background work" is information; "Asked you a question" is a request.
 */
export function resolveState(payload) {
	if (isQuestion(payload?.last_assistant_message)) return ASKED;
	if (backgroundCount(payload?.background_tasks) > 0) return BACKGROUND;
	return DONE;
}

function main() {
	let raw = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => {
		raw += chunk;
	});
	process.stdin.on('end', () => {
		let out = DONE;
		try {
			out = resolveState(JSON.parse(raw));
		} catch {
			// A payload we cannot parse is not evidence of a question.
		}
		process.stdout.write(out);
	});
	process.stdin.on('error', () => {
		process.stdout.write(DONE);
	});
}

// Importable from the test without consuming stdin. `pathToFileURL(resolve(…))`
// and not a hand-built `file://` string: the shell invokes this through
// `dirname "$0"`, so argv[1] is routinely relative, and a naive comparison
// would silently never run `main()` — the pill would just always read
// "Finished" and nothing would look broken.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
