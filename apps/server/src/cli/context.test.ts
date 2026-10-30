import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISUAL_LIMITS } from '@ruimte/contracts';
import { unescapeText } from '../canvas/text-escapes.ts';
import { VERBS } from '../canvas/verbs.ts';
import { runContext } from './context.ts';

let env: Record<string, string>;
let stdout: string;
let stderr: string;
let restore: Array<() => void>;
let seen: { verb: string; argv: unknown; authorization: string | null }[];
let sources: { id: string; kind: string; title: string; flag?: string; snoozedUntil?: string }[];
let tails: string[];
let fetched: string[];
let folder: string;

const png = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17)]);

async function unreadStdin(): Promise<string> {
    throw new Error('stdin was read');
}

async function file(name: string, bytes: Uint8Array | string): Promise<string> {
    const path = join(folder, name);
    await writeFile(path, bytes);
    return path;
}

/* The daemon's side of `/context` and `/canvas`, answered in the process instead of on a port. */
const daemon = {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.headers.get('authorization') === 'Bearer stale') {
            return new Response('Unknown token', { status: 401 });
        }
        if (url.pathname === '/context') {
            return Response.json({ sources });
        }
        if (url.pathname === '/context/c2') {
            const text = '> Usage: claude opus\n\nthe thread';
            return url.searchParams.has('json') ? Response.json({ text, usage: { contextTokens: 10 } }) : new Response(text);
        }
        if (url.pathname === '/context/n1') {
            const tail = url.searchParams.get('tail');
            if (tail === null) {
                return new Response('the plan');
            }
            tails.push(tail);
            return new Response('the last lines');
        }
        if (url.pathname === '/context/c1') {
            const subagent = url.searchParams.get('subagent');
            if (subagent !== 'toolu_1') {
                return new Response('Claude has not written a transcript for this subagent', { status: 422 });
            }
            return new Response(`subagent ${subagent}${url.searchParams.has('tail') ? ` tail ${url.searchParams.get('tail')}` : ''}`);
        }
        if (url.pathname === '/context/sketch') {
            const form = url.searchParams.get('form');
            return form === 'image'
                ? new Response('refused\tvisual-needs-chat\tA visual shows only in the thread of an AI chat', { status: 422 })
                : new Response(`sketch as ${form}`);
        }
        if (url.pathname === '/context/term-2') {
            return new Response(`the screen of term-2 on ${url.searchParams.get('view')}`);
        }
        if (url.pathname === '/context/boom') {
            return new Response('no', { status: 500 });
        }
        // A neighbour the line runs the wrong way into: the daemon is the side that can tell.
        if (url.pathname === '/context/term') {
            return new Response(
                [
                    'not-linked\tterm is a terminal node on main with a line from you into it',
                    'see\truimte-context link new --from term --to chat-1\tdraws it'
                ].join('\n'),
                { status: 404 }
            );
        }
        if (!url.pathname.startsWith('/canvas/')) {
            return new Response('Not found', { status: 404 });
        }
        const verb = decodeURIComponent(url.pathname.slice('/canvas/'.length));
        const { argv } = (await request.json()) as { argv: string[] };
        seen.push({ verb, argv, authorization: request.headers.get('authorization') });
        switch (verb) {
            case 'node':
                if (argv[0] === 'list') {
                    return new Response('refused\tview-required\tname one with --view\ncanvas\tmain\tCanvas\n', { status: 422 });
                }
                return new Response('note-12345678\tnote\tmain\n');
            case 'view':
                return new Response('flow-1\t1\t0\t0\t0\n');
            case 'done':
                return new Response('done\ttask-1\tchat-lead\n');
            case 'visual':
                return new Response(argv[0] === 'preview' ? 'shot\t/home/shot.png\tthe png\nnext\tshow it\n' : 'visual\tv1\tShots\t100 bytes\n');
            case 'chat':
                return new Response('attachment\tagent-1\tshot.png\timage/png\t29\n');
            case 'broken':
                return new Response('boom', { status: 500 });
            default:
                return new Response(`refused\tunknown-verb\t${verb} is not a verb\n`, { status: 404 });
        }
    }
};

beforeEach(() => {
    env = { RUIMTE_CONTEXT_URL: 'http://daemon.test/context', RUIMTE_HOOK_TOKEN: 'tok' };
    const requests = spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        fetched.push(request.url);
        // Any other address is a daemon that is not there, which fetch reports by rejecting.
        if (new URL(request.url).host !== 'daemon.test') {
            return Promise.reject(new TypeError('Unable to connect'));
        }
        return daemon.fetch(request);
    }) as typeof fetch);
    stdout = '';
    stderr = '';
    seen = [];
    sources = [{ id: 'n1', kind: 'text', title: 'Plan' }];
    tails = [];
    fetched = [];
    const out = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
    });
    const err = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderr += String(chunk);
        return true;
    });
    const log = spyOn(console, 'log').mockImplementation((...parts) => {
        stdout += `${parts.join(' ')}\n`;
    });
    const error = spyOn(console, 'error').mockImplementation((...parts) => {
        stderr += `${parts.join(' ')}\n`;
    });
    restore = [requests, out, err, log, error].map((spy) => () => spy.mockRestore());
});

afterEach(() => {
    for (const undo of restore) {
        undo();
    }
});

describe('runContext', () => {
    test('outside a session exits 2', async () => {
        expect(await runContext(['node', 'new', 'note'], {})).toBe(2);
    });

    test('bare and list still list the linked sources', async () => {
        expect(await runContext([], env)).toBe(0);
        expect(await runContext(['list'], env)).toBe(0);
        expect(stdout).toBe('n1\ttext\tPlan\t-\t-\nn1\ttext\tPlan\t-\t-\n');
        expect(seen).toEqual([]);
    });

    test('list prints until when a person snoozed a source', async () => {
        sources = [{ id: 'c1', kind: 'chat', title: 'Lead', flag: 'red', snoozedUntil: '2026-10-13T15:30:00.000Z' }];
        expect(await runContext(['list'], env)).toBe(0);
        expect(stdout).toBe('c1\tchat\tLead\tred\t2026-10-13T15:30:00.000Z\n');
    });

    test('read prints one source from /context and never posts to /canvas', async () => {
        expect(await runContext(['read', 'n1'], env)).toBe(0);
        expect(stdout).toBe('the plan\n');
        expect(seen).toEqual([]);
    });

    test('--json asks the daemon for one object and prints it, and a daemon that answers text alone gives that as its text', async () => {
        expect(await runContext(['read', 'c2', '--json'], env)).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ text: '> Usage: claude opus\n\nthe thread', usage: { contextTokens: 10 } });
        stdout = '';
        expect(await runContext(['read', 'n1', '--json'], env)).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ text: 'the plan' });
    });

    test('read without an id is a refusal that lists what there is to read', async () => {
        expect(await runContext(['read'], env)).toBe(3);
        expect(stderr).toBe(
            [
                'refused\tbad-arguments\tread takes the id of a linked source',
                'usage\tread\t<id> [--tail N] [--subagent T] [--view V | --project P] [--elements | --image] [--json]',
                'detail\truimte-context help read',
                'n1\ttext\tPlan'
            ].join('\n') + '\n'
        );
        expect(stdout).toBe('');
        expect(seen).toEqual([]);
    });

    test('--tail rides along as a query the daemon counts, written either way', async () => {
        expect(await runContext(['read', 'n1', '--tail', '15'], env)).toBe(0);
        expect(await runContext(['read', 'n1', '--tail=15'], env)).toBe(0);
        expect(tails).toEqual(['15', '15']);
        expect(stdout).toBe('the last lines\nthe last lines\n');
    });

    test('--subagent rides along beside --tail, and a subagent the daemon cannot find is a refusal', async () => {
        expect(await runContext(['read', 'c1', '--subagent', 'toolu_1'], env)).toBe(0);
        expect(await runContext(['read', 'c1', '--subagent=toolu_1', '--tail', '5'], env)).toBe(0);
        expect(stdout).toBe('subagent toolu_1\nsubagent toolu_1 tail 5\n');
        expect(await runContext(['read', 'c1', '--subagent', 'toolu_2'], env)).toBe(3);
        expect(stderr).toStartWith('refused\tunknown-subagent\tClaude has not written a transcript for this subagent\nusage\tread\t');
        stderr = '';
        expect(await runContext(['read', 'c1', '--subagent'], env)).toBe(3);
        expect(stderr).toStartWith('refused\tbad-arguments\t--subagent needs');
    });

    test('--elements and --image ask for a form, one at a time, and a refusal of the form arrives whole', async () => {
        expect(await runContext(['read', 'sketch', '--elements'], env)).toBe(0);
        expect(stdout).toBe('sketch as elements\n');
        expect(await runContext(['read', 'sketch', '--image'], env)).toBe(3);
        expect(stderr).toBe('refused\tvisual-needs-chat\tA visual shows only in the thread of an AI chat\n');
        stderr = '';
        expect(await runContext(['read', 'sketch', '--image', '--elements'], env)).toBe(3);
        expect(stderr).toStartWith('refused\tbad-arguments\tread takes --elements or --image, not both');
    });

    test('--view rides along as the canvas a chat view reads a node of, and an empty one is refused before anything is asked', async () => {
        expect(await runContext(['read', 'term-2', '--view', 'main'], env)).toBe(0);
        expect(await runContext(['read', 'term-2', '--view=board'], env)).toBe(0);
        expect(stdout).toBe('the screen of term-2 on main\nthe screen of term-2 on board\n');
        const beforeRefusal = [...fetched];
        expect(beforeRefusal).toHaveLength(2);
        expect(await runContext(['read', 'term-2', '--view='], env)).toBe(3);
        expect(stderr).toStartWith('refused\tbad-arguments\t--view needs the id of the canvas the source stands on');
        expect(fetched).toEqual(beforeRefusal);
    });

    test('a --tail that is not a positive whole number is refused before anything is asked', async () => {
        for (const argv of [
            ['read', 'n1', '--tail'],
            ['read', 'n1', '--tail', 'two'],
            ['read', 'n1', '--tail', '0'],
            ['read', 'n1', '--tail=-3'],
            ['read', 'n1', '--tail', '1.5']
        ]) {
            stderr = '';
            tails = [];
            expect(await runContext(argv, env)).toBe(3);
            expect(stderr).toStartWith('refused\tbad-arguments\t--tail needs a positive whole number of lines');
            expect(tails).toEqual([]);
            expect(fetched).toEqual([]);
        }
    });

    // The daemon here answers a plain 404, the way an older one does; what it said is the only reason there is.
    test('a source that is not linked is a refusal that names the ones that are', async () => {
        expect(await runContext(['read', 'nonsense'], env)).toBe(3);
        expect(stderr).toBe(['refused\tunknown-source\tnonsense could not be read: Not found', 'n1\ttext\tPlan'].join('\n') + '\n');
        expect(stdout).toBe('');
    });

    test('a refused read carries the code, the sentence and the call the daemon wrote for it', async () => {
        expect(await runContext(['read', 'term'], env)).toBe(3);
        expect(stderr).toBe(
            [
                'refused\tnot-linked\tterm is a terminal node on main with a line from you into it',
                'n1\ttext\tPlan',
                'see\truimte-context link new --from term --to chat-1\tdraws it'
            ].join('\n') + '\n'
        );
        expect(stdout).toBe('');
    });

    test('a refusal with nothing linked says so instead of listing nothing', async () => {
        sources = [];
        expect(await runContext(['read', 'nonsense'], env)).toBe(3);
        expect(stderr).toBe(['refused\tunknown-source\tnonsense could not be read: Not found', 'note\tNothing is linked to this session'].join('\n') + '\n');
    });

    test('a token the daemon does not know is no session, for list, read and a verb alike', async () => {
        const stale = { ...env, RUIMTE_HOOK_TOKEN: 'stale' };
        expect(await runContext(['list'], stale)).toBe(2);
        expect(await runContext(['read', 'n1'], stale)).toBe(2);
        expect(await runContext(['read', 'n1', '--tail', '3'], stale)).toBe(2);
        expect(await runContext(['node', 'list'], stale)).toBe(2);
        expect(stderr.trim().split('\n')).toEqual(Array.from({ length: 4 }, () => 'Not inside a live Ruimte session: the daemon answered 401 Unknown token'));
        expect(stdout).toBe('');
    });

    test('a daemon that fails or is not there stays a failure, not a refusal', async () => {
        expect(await runContext(['read', 'boom'], env)).toBe(1);
        const gone = { ...env, RUIMTE_CONTEXT_URL: 'http://127.0.0.1:1/context' };
        expect(await runContext(['read', 'n1'], gone)).toBe(1);
        expect(await runContext(['list'], gone)).toBe(1);
        expect(stderr).toInclude('Could not reach the daemon');
        expect(stdout).toBe('');
    });

    test('a daemon out of reach says when a sandbox is the likely reason', async () => {
        const gone = { ...env, RUIMTE_CONTEXT_URL: 'http://127.0.0.1:1/context' };
        const retry = 'run the same command again with network access or escalated permissions';
        expect(await runContext(['node', 'list'], { ...gone, CODEX_SANDBOX: 'seatbelt', CODEX_SANDBOX_NETWORK_DISABLED: '1' })).toBe(1);
        expect(stderr).toBe(
            `Could not reach the daemon: Unable to connect. This command runs in a sandbox without network access, which blocks the daemon's local address; ${retry}.\n`
        );
        stderr = '';
        expect(await runContext(['list'], { ...gone, CODEX_SANDBOX: 'seatbelt' })).toBe(1);
        expect(stderr).toBe(
            `Could not reach the daemon: Unable to connect. This command runs in a sandbox, which may block the daemon's local address; if so, ${retry}.\n`
        );
        stderr = '';
        expect(await runContext(['read', 'n1'], gone)).toBe(1);
        expect(stderr).toBe(
            `Could not reach the daemon: Unable to connect. A sandbox without network access is a common cause; if this command runs in one, ${retry}.\n`
        );
    });

    test('a verb posts its argv to /canvas/<verb> and prints the answer', async () => {
        expect(await runContext(['node', 'new', 'note', '--text', 'hello'], env)).toBe(0);
        expect(seen).toEqual([{ verb: 'node', argv: ['new', 'note', '--text', 'hello'], authorization: 'Bearer tok' }]);
        expect(stdout).toBe('note-12345678\tnote\tmain\n');
    });

    /* The top-level help and every refusal over arguments point at `ruimte-context help <verb>`, so
       a verb and its argument arriving as one name would make all of them dead ends. */
    test('help <verb> travels as the verb help with the name as its argument, for every verb there is', async () => {
        for (const verb of VERBS) {
            await runContext(['help', verb.name], env);
        }
        expect(seen.map((call) => [call.verb, call.argv])).toEqual(VERBS.map((verb) => ['help', [verb.name]]));
    });

    test('help <noun> <action> travels as the verb help with both words, for every action there is', async () => {
        const actions = VERBS.flatMap((entry) => (entry.served === 'noun' ? entry.actions.map((action) => action.name.split(' ')) : []));
        for (const words of actions) {
            await runContext(['help', ...words], env);
        }
        expect(seen.map((call) => [call.verb, call.argv])).toEqual(actions.map((words) => ['help', words]));
    });

    test('--text - takes the body from stdin, escaped so the daemon reads it back byte for byte', async () => {
        const body = 'Line one\nLine two\\n still one line\n';
        expect(await runContext(['node', 'new', 'note', '--text', '-'], env, async () => body)).toBe(0);
        expect(await runContext(['node', 'new', 'note', '--text=-'], env, async () => body)).toBe(0);
        const sent = seen.map((call) => call.argv);
        expect(sent[0]).toEqual(['new', 'note', '--text=Line one\nLine two\\\\n still one line\n']);
        expect(sent[1]).toEqual(sent[0]);
        expect(unescapeText((sent[0] as string[])[2]!.slice('--text='.length))).toBe(body);
    });

    test('node new --json - takes the array of nodes from stdin as it is, since JSON has escapes of its own', async () => {
        const nodes = '[{"kind":"note","text":"a\\nb"}]\n';
        expect(await runContext(['node', 'new', '--json', '-', '--view', 'board'], env, async () => nodes)).toBe(0);
        expect(await runContext(['node', 'new', '--json=-'], env, async () => nodes)).toBe(0);
        expect(seen.map((call) => call.argv)).toEqual([
            ['new', `--json=${nodes}`, '--view', 'board'],
            ['new', `--json=${nodes}`]
        ]);
    });

    test('node edit and node rename take --json - from stdin the same way, and node edit keeps --text - as it was', async () => {
        const edits = '[{"id":"note-1","text":"a\\nb"}]\n';
        expect(await runContext(['node', 'edit', '--json', '-'], env, async () => edits)).toBe(0);
        expect(await runContext(['node', 'rename', '--json=-', '--view', 'board'], env, async () => edits)).toBe(0);
        expect(await runContext(['node', 'edit', 'note-1', '--text', '-'], env, async () => 'a\\b')).toBe(0);
        expect(seen.map((call) => call.argv)).toEqual([
            ['edit', `--json=${edits}`],
            ['rename', `--json=${edits}`, '--view', 'board'],
            ['edit', 'note-1', '--text=a\\\\b']
        ]);
    });

    test('--result - takes the result of a task from stdin the same way', async () => {
        const body = 'Found it\nin two places\n';
        expect(await runContext(['done', '--result', '-'], env, async () => body)).toBe(0);
        const argv = seen.at(-1)!.argv as string[];
        expect(argv).toHaveLength(1);
        expect(unescapeText(argv[0]!.slice('--result='.length))).toBe(body);
    });

    test('a --text that is not a dash is passed on untouched, and stdin is never read', async () => {
        expect(await runContext(['node', 'new', 'note', '--text', 'a\\nb', '--title', '-'], env, unreadStdin)).toBe(0);
        expect(seen[0]!.argv).toEqual(['new', 'note', '--text', 'a\\nb', '--title', '-']);
    });

    test('view diagram sends stdin as --document byte for byte, and leaves stdin unread when --document is given', async () => {
        const document = '{"meta":{"title":"a\\nb","direction":"right"}}\n';
        expect(await runContext(['view', 'diagram', 'flow-1'], env, async () => document)).toBe(0);
        expect(seen[0]!.argv).toEqual(['diagram', 'flow-1', `--document=${document}`]);
        expect(stdout).toBe('flow-1\t1\t0\t0\t0\n');
        expect(await runContext(['view', 'diagram', 'flow-1', '--document', '{}'], env, unreadStdin)).toBe(0);
        expect(seen[1]!.argv).toEqual(['diagram', 'flow-1', '--document', '{}']);
    });

    test('plan new sends stdin as --document, or as --markdown for --markdown -, byte for byte', async () => {
        const document = '{"items":[{"type":"step","title":"a\\\\nb"}]}\n';
        await runContext(['plan', 'new', '--title', 'T'], env, async () => document);
        expect(seen[0]!.argv).toEqual(['new', '--title', 'T', `--document=${document}`]);
        const markdown = '- [ ] one \\n two\n';
        await runContext(['plan', 'new', '--markdown', '-', '--kind', 'test'], env, async () => markdown);
        expect(seen[1]!.argv).toEqual(['new', `--markdown=${markdown}`, '--kind', 'test']);
        await runContext(['plan', 'note', 'a', '--text', '-'], env, async () => 'x\\y');
        expect(seen[2]!.argv).toEqual(['note', 'a', '--text=x\\\\y']);
    });

    test('visual write, show and preview send stdin as --html byte for byte, and leave stdin unread when --html is given', async () => {
        const page = '<!doctype html>\n<p title="a\\nb">Ten\tcases</p>\n';
        await runContext(['visual', 'show', '--title', 'Cases', '--height', '200'], env, async () => page);
        expect(seen[0]!.argv).toEqual(['show', '--title', 'Cases', '--height', '200', `--html=${page}`]);
        await runContext(['visual', 'show', '--title', 'Cases', '--html=<p>x</p>'], env, unreadStdin);
        expect(seen[1]!.argv).toEqual(['show', '--title', 'Cases', '--html=<p>x</p>']);
        await runContext(['visual', 'list'], env, unreadStdin);
        expect(seen[2]!.argv).toEqual(['list']);
        await runContext(['visual', 'preview', '--width', '400'], env, async () => page);
        expect(seen[3]!.argv).toEqual(['preview', '--width', '400', `--html=${page}`]);
        await runContext(['visual', 'write', '--name', 'cases.html'], env, async () => page);
        expect(seen[4]!.argv).toEqual(['write', '--name', 'cases.html', `--html=${page}`]);
        await runContext(['visual', 'write', '--name', 'cases.html', '--html=<p>Updated</p>'], env, unreadStdin);
        expect(seen[5]!.argv).toEqual(['write', '--name', 'cases.html', '--html=<p>Updated</p>']);
    });

    test('a refusal exits 3 and goes to stderr', async () => {
        expect(await runContext(['node', 'list'], env)).toBe(3);
        expect(stderr).toBe('refused\tview-required\tname one with --view\ncanvas\tmain\tCanvas\n');
        expect(stdout).toBe('');
    });

    test('an unknown verb is a refusal too', async () => {
        expect(await runContext(['agent', 'claude'], env)).toBe(3);
        expect(stderr).toStartWith('refused\tunknown-verb\t');
    });

    test('a daemon error exits 1, and so does a daemon that is not there', async () => {
        expect(await runContext(['broken'], env)).toBe(1);
        expect(await runContext(['help'], { ...env, RUIMTE_CONTEXT_URL: 'http://127.0.0.1:1/context' })).toBe(1);
    });
});

describe('local images of a visual', () => {
    const notAnImage = 'its bytes are not a PNG, JPEG, GIF, WebP, AVIF, HEIF, SVG, BMP or ICO image';

    beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), 'ruimte-context-visual-'));
    });

    afterEach(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    function embedded(bytes: Uint8Array): string {
        return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    }

    test('show embeds a local image in the page before it goes out, from stdin or from --html', async () => {
        const shot = await file('shot.png', png);
        expect(await runContext(['visual', 'show', '--title', 'Shots'], env, async () => `<img src="${shot}">`)).toBe(0);
        expect(await runContext(['visual', 'show', '--title', 'Shots', `--html=<p style="background:url(${shot})">`], env)).toBe(0);
        expect(seen.map((call) => call.argv)).toEqual([
            ['show', '--title', 'Shots', `--html=<img src="${embedded(png)}">`],
            ['show', '--title', 'Shots', `--html=<p style="background:url(${embedded(png)})">`]
        ]);
        expect(stdout).toBe('visual\tv1\tShots\t100 bytes\nvisual\tv1\tShots\t100 bytes\n');
    });

    test('show refuses without sending when a path names no image file, and names every one', async () => {
        const gone = join(folder, 'gone.png');
        const text = await file('notes.png', 'a list of things to do\n');
        const shot = await file('shot.png', png);
        const page = `<img src="${gone}"><img src="${shot}"><script>const notes = '${text}';</script>`;
        expect(await runContext(['visual', 'show', '--title', 'Shots'], env, async () => page)).toBe(3);
        expect(stderr).toBe(
            [
                `refused\tvisual-images-missing\tThe page names 2 paths with no image file on this machine: ${gone}, ${text}; use absolute paths to existing image files, or remove them from the page`,
                `missing\t${gone}\tnot embedded: no image file there`,
                `missing\t${text}\tnot embedded: ${notAnImage}`,
                'detail\truimte-context help visual'
            ].join('\n') + '\n'
        );
        expect(stdout).toBe('');
        expect(seen).toEqual([]);
    });

    test('show refuses an image past 10 MiB, and a page that cannot hold its images, naming the size and the limit', async () => {
        const large = await file('large.png', png);
        await truncate(large, 10 * 1024 * 1024 + 1);
        expect(await runContext(['visual', 'show', '--title', 'Shots'], env, async () => `<img src="${large}">`)).toBe(3);
        expect(stderr).toBe(
            [
                `refused\tvisual-image-too-large\tAn image may be at most 10 MiB, and the page names one larger: ${large}; scale it down, or refer to it by an http(s) URL`,
                `too-large\t${large}\tnot embedded: 10.1 MiB, more than the 10 MiB an image may be`,
                'detail\truimte-context help visual'
            ].join('\n') + '\n'
        );
        stderr = '';
        const shot = await file('shot.png', Buffer.concat([png, Buffer.alloc(300)]));
        const full = `${'x'.repeat(VISUAL_LIMITS.bytes - 100)}<img src="${shot}">`;
        expect(await runContext(['visual', 'show', '--title', 'Shots'], env, async () => full)).toBe(3);
        expect(stderr).toBe(
            [
                'refused\tvisual-too-large\tWith its images embedded the page would be at least 16.1 MiB, and a visual may be at most 16 MiB; embed fewer or smaller images, or refer to them by their http(s) URL',
                'detail\truimte-context help visual'
            ].join('\n') + '\n'
        );
        expect(seen).toEqual([]);
    });

    test('preview embeds what it can, leaves the rest as written and names it after the daemon lines', async () => {
        const shot = await file('shot.png', png);
        const gone = join(folder, 'gone.png');
        const text = await file('notes.jpg', 'a list of things to do\n');
        const page = `<img src="${shot}"><img src="${gone}"><img src="${text}">`;
        expect(await runContext(['visual', 'preview', '--width', '400'], env, async () => page)).toBe(0);
        expect(seen.map((call) => call.argv)).toEqual([
            ['preview', '--width', '400', `--html=<img src="${embedded(png)}"><img src="${gone}"><img src="${text}">`]
        ]);
        expect(stdout).toBe(
            [
                'shot\t/home/shot.png\tthe png',
                'next\tshow it',
                `missing\t${gone}\tnot embedded: no image file there`,
                `missing\t${text}\tnot embedded: ${notAnImage}`
            ].join('\n') + '\n'
        );
        expect(stderr).toBe('');
    });
});

describe('chat attach', () => {
    beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), 'ruimte-context-attach-'));
    });

    afterEach(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    test('reads the file in its own process and sends the name and the bytes, never the path', async () => {
        const shot = await file('shot.png', png);
        expect(await runContext(['chat', 'attach', '--file', shot], env)).toBe(0);
        expect(await runContext(['chat', 'attach', `--file=${shot}`, '--name', 'Home screen'], env)).toBe(0);
        expect(seen.map((call) => [call.verb, call.argv])).toEqual([
            ['chat', ['attach', '--name', 'shot.png', `--data=${png.toString('base64')}`]],
            ['chat', ['attach', '--name', 'Home screen', `--data=${png.toString('base64')}`]]
        ]);
        expect(JSON.stringify(seen)).not.toContain(folder);
        expect(stdout).toBe('attachment\tagent-1\tshot.png\timage/png\t29\nattachment\tagent-1\tshot.png\timage/png\t29\n');
    });

    test('a missing file, a file that is no image and one past the limit are refused without a call to the daemon', async () => {
        const gone = join(folder, 'gone.png');
        const text = await file('notes.png', 'a list of things to do\n');
        const large = await file('large.png', Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]));
        const codes: string[] = [];
        for (const path of [gone, text, large]) {
            stderr = '';
            expect(await runContext(['chat', 'attach', '--file', path], env)).toBe(3);
            codes.push(stderr.split('\t')[1]!);
        }
        expect(codes).toEqual(['attach-unreadable', 'attach-not-image', 'attach-too-large']);
        expect(seen).toEqual([]);
    });

    test('reads a model by its bytes and sends it, up to 50 MiB, and refuses a zip that is no USDZ', async () => {
        const triangles = Math.floor((50 * 1024 * 1024 - 84) / 50);
        const stl = Buffer.alloc(84 + 50 * triangles);
        stl.writeUInt32LE(triangles, 80);
        const part = await file('part.bin', stl);
        expect(await runContext(['chat', 'attach', '--file', part], env)).toBe(0);
        expect(seen.map((call) => call.argv)).toEqual([['attach', '--name', 'part.bin', `--data=${stl.toString('base64')}`]]);

        // Sparse, since the refusal reads no further than the limit and a real 50 MiB write is what a slow runner stalls on.
        const header = Buffer.alloc(84);
        header.writeUInt32LE(triangles + 1, 80);
        const larger = await file('larger.stl', header);
        await truncate(larger, stl.length + 50);
        const zip = Buffer.alloc(64);
        zip.write('PK\x03\x04', 0, 'latin1');
        zip.writeUInt16LE(10, 26);
        zip.write('readme.txt', 30);
        const codes: string[] = [];
        for (const path of [larger, await file('scene.usdz', zip)]) {
            stderr = '';
            expect(await runContext(['chat', 'attach', '--file', path], env)).toBe(3);
            codes.push(stderr.split('\t')[1]!);
        }
        expect(codes).toEqual(['attach-too-large', 'attach-not-image']);
        expect(seen).toHaveLength(1);
    });

    test('without --file it refuses with the usage, and a word it does not know goes to the daemon to be refused there', async () => {
        expect(await runContext(['chat', 'attach'], env)).toBe(3);
        expect(stderr).toContain('refused\tbad-arguments\tchat attach needs --file <path>');
        expect(seen).toEqual([]);
        const shot = await file('shot.png', png);
        await runContext(['chat', 'attach', '--file', shot, '--mime', 'image/png'], env);
        expect(seen[0]!.argv).toEqual(['attach', '--mime', 'image/png', '--name', 'shot.png', `--data=${png.toString('base64')}`]);
    });
});
