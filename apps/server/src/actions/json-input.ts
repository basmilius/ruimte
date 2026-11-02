import { VerbRefusal } from '../canvas/verb.ts';

// Enough to repair a document in one pass, few enough that a broken one does not fill the window.
export const MAX_PROBLEMS = 20;

/* JSON an agent handed in on stdin, refused with the parser's own reason; `what` names it ("document", "edit"). */
export function parseJson(source: string, what: string): unknown {
    try {
        return JSON.parse(source);
    } catch (e) {
        throw new VerbRefusal('bad-json', `The ${what} is not JSON: ${e instanceof Error ? e.message : 'it does not parse'}`);
    }
}

/* A zod issue path as an agent writes it: `nodes[3].label`. */
export function pathOf(path: readonly PropertyKey[]): string {
    return path.reduce<string>((text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`), '');
}

/* Every problem of a document as a line of its own, led by the first in the message. */
export function problemsRefusal(code: string, problems: readonly { path: string; text: string }[]): VerbRefusal {
    const [first] = problems;

    return new VerbRefusal(code, `${first!.path} ${first!.text}`, [
        ...problems.slice(0, MAX_PROBLEMS).map((problem) => `problem\t${problem.path}\t${problem.text}`),
        ...(problems.length > MAX_PROBLEMS ? [`note\t${problems.length - MAX_PROBLEMS} more past these`] : [])
    ]);
}
