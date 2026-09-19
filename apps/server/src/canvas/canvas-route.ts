import { z } from 'zod';
import { ProjectError } from '../projects/project-store.ts';
import { VerbRefusal, type CanvasHost } from './verb.ts';
import { verbNamed, verbSummaryLines } from './verbs.ts';
import { errorText } from '../error-text.ts';
import { refusalBody } from '../refusal.ts';

export const CANVAS_PATH = '/canvas';

const BodySchema = z.object({ argv: z.array(z.string()) });

const TEXT = { 'content-type': 'text/plain; charset=utf-8' };

const text = (lines: string[], status = 200): Response => new Response(lines.length === 0 ? '' : `${lines.join('\n')}\n`, { status, headers: TEXT });

const refusal = (code: string, message: string, lines: string[] = [], status = 422): Response =>
    new Response(`${refusalBody(code, message, lines)}\n`, { status, headers: TEXT });

/*
 * A name with a space in it is a caller that quoted the whole line ("help agent"), which otherwise
 * only gets the verb list back and no hint of what went wrong.
 */
const joinedWordsLines = (name: string): string[] => {
    const [first, ...rest] = name.split(/\s+/).filter((word) => word !== '');
    if (rest.length === 0 || !first || !verbNamed(first)) {
        return [];
    }
    return [`note\tA verb and its arguments are separate words, so this is ruimte-context ${first} ${rest.join(' ')}, not one name`];
};

interface CanvasRouteDeps {
    /* The session or chat a bearer token speaks for. */
    targetForToken(token: string): string | null;
    host: CanvasHost;
}

/*
 * `POST /canvas/<verb or noun>` with `{ argv }`, the words after it. The daemon parses them rather
 * than the CLI, so a `ruimte-context` from an older build never disagrees with the verbs it talks to.
 */
export const handleCanvasRequest = async (request: Request, pathname: string, deps: CanvasRouteDeps): Promise<Response> => {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const caller = token ? deps.targetForToken(token) : null;
    if (!caller) {
        return new Response('Unknown token', { status: 401 });
    }
    let name: string;
    try {
        name = decodeURIComponent(pathname.slice(CANVAS_PATH.length + 1));
    } catch {
        name = '';
    }
    const verb = verbNamed(name);
    if (!verb) {
        return refusal(
            'unknown-verb',
            `${name || '(none)'} is not a verb or a noun`,
            [...joinedWordsLines(name), 'detail\truimte-context help\tevery verb and noun, with what each takes', ...verbSummaryLines()],
            404
        );
    }
    if (verb.served === 'context') {
        return refusal('not-a-canvas-verb', `${name} is answered by GET /context; run ruimte-context ${name}`, [], 404);
    }
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
        return refusal('bad-request', 'The body must be { "argv": string[] }');
    }
    try {
        return text(await verb.run(body.data.argv, { caller, host: deps.host }));
    } catch (e) {
        if (e instanceof VerbRefusal) {
            return refusal(e.code, e.message, e.lines);
        }
        if (e instanceof ProjectError) {
            return refusal(e.code, e.message);
        }
        console.error(`Canvas verb ${name} failed:`, errorText(e));
        return new Response(`The verb failed: ${errorText(e)}`, { status: 500, headers: TEXT });
    }
};
