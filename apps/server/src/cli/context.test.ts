import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { unescapeText } from '../canvas/text-escapes.ts';
import { VERBS } from '../canvas/verbs.ts';
import { runContext } from './context.ts';

let env: Record<string, string>;
let stdout: string;
let stderr: string;
let restore: Array<() => void>;
let seen: { verb: string; argv: unknown; authorization: string | null }[];
let sources: { id: string; kind: string; title: string }[];
let tails: string[];

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
        expect(stdout).toBe('n1\ttext\tPlan\nn1\ttext\tPlan\n');
        expect(seen).toEqual([]);
    });

    test('read prints one source from /context and never posts to /canvas', async () => {
        expect(await runContext(['read', 'n1'], env)).toBe(0);
        expect(stdout).toBe('the plan\n');
        expect(seen).toEqual([]);
    });

    test('read without an id is a refusal that lists what there is to read', async () => {
        expect(await runContext(['read'], env)).toBe(3);
        expect(stderr).toBe(
            [
                'refused\tbad-arguments\tread takes the id of a linked source',
                'usage\tread\t<id> [--tail N] [--subagent T]',
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

    test('--result - takes the result of a task from stdin the same way', async () => {
        const body = 'Found it\nin two places\n';
        expect(await runContext(['done', '--result', '-'], env, async () => body)).toBe(0);
        const argv = seen.at(-1)!.argv as string[];
        expect(argv).toHaveLength(1);
        expect(unescapeText(argv[0]!.slice('--result='.length))).toBe(body);
    });

    test('a --text that is not a dash is passed on untouched, and stdin is never read', async () => {
        const stdin = async (): Promise<string> => {
            throw new Error('stdin was read');
        };
        expect(await runContext(['node', 'new', 'note', '--text', 'a\\nb', '--title', '-'], env, stdin)).toBe(0);
        expect(seen[0]!.argv).toEqual(['new', 'note', '--text', 'a\\nb', '--title', '-']);
    });

    test('view diagram sends stdin as --document byte for byte, and leaves stdin unread when --document is given', async () => {
        const document = '{"meta":{"title":"a\\nb","direction":"right"}}\n';
        expect(await runContext(['view', 'diagram', 'flow-1'], env, async () => document)).toBe(0);
        expect(seen[0]!.argv).toEqual(['diagram', 'flow-1', `--document=${document}`]);
        expect(stdout).toBe('flow-1\t1\t0\t0\t0\n');
        const stdin = async (): Promise<string> => {
            throw new Error('stdin was read');
        };
        expect(await runContext(['view', 'diagram', 'flow-1', '--document', '{}'], env, stdin)).toBe(0);
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
