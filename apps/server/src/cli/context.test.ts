import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Server } from 'bun';
import { unescapeText } from '../canvas/text-escapes.ts';
import { VERBS } from '../canvas/verbs.ts';
import { runContext } from './context.ts';

let server: Server<undefined>;
let env: Record<string, string>;
let stdout: string;
let stderr: string;
let restore: Array<() => void>;
let seen: { verb: string; argv: unknown; authorization: string | null }[];
let sources: { id: string; kind: string; title: string }[];

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/context') {
                return Response.json({ sources });
            }
            if (url.pathname === '/context/n1') {
                return new Response('the plan');
            }
            if (url.pathname === '/context/boom') {
                return new Response('no', { status: 500 });
            }
            if (!url.pathname.startsWith('/canvas/')) {
                return new Response('Not found', { status: 404 });
            }
            const verb = decodeURIComponent(url.pathname.slice('/canvas/'.length));
            const { argv } = (await request.json()) as { argv: string[] };
            seen.push({ verb, argv, authorization: request.headers.get('authorization') });
            switch (verb) {
                case 'node':
                    return new Response('note-12345678\tnote\tmain\n');
                case 'nodes':
                    return new Response('refused\tview-required\tname one with --view\ncanvas\tmain\tCanvas\n', { status: 422 });
                case 'broken':
                    return new Response('boom', { status: 500 });
                default:
                    return new Response(`refused\tunknown-verb\t${verb} is not a verb\n`, { status: 404 });
            }
        }
    });
});

afterAll(() => {
    server.stop(true);
});

beforeEach(() => {
    env = { RUIMTE_CONTEXT_URL: `http://127.0.0.1:${server.port}/context`, RUIMTE_HOOK_TOKEN: 'tok' };
    stdout = '';
    stderr = '';
    seen = [];
    sources = [{ id: 'n1', kind: 'text', title: 'Plan' }];
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
    restore = [out, err, log, error].map((spy) => () => spy.mockRestore());
});

afterEach(() => {
    for (const undo of restore) {
        undo();
    }
});

describe('runContext', () => {
    test('outside a session exits 2', async () => {
        expect(await runContext(['node', 'note'], {})).toBe(2);
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
            ['refused\tbad-arguments\tread takes the id of a linked source', 'usage\tread\t<id>', 'detail\truimte-context help read', 'n1\ttext\tPlan'].join(
                '\n'
            ) + '\n'
        );
        expect(stdout).toBe('');
        expect(seen).toEqual([]);
    });

    test('a source that is not linked is a refusal that names the ones that are', async () => {
        expect(await runContext(['read', 'nonsense'], env)).toBe(3);
        expect(stderr).toBe(['refused\tunknown-source\tnonsense is not linked to this session', 'n1\ttext\tPlan'].join('\n') + '\n');
        expect(stdout).toBe('');
    });

    test('a refusal with nothing linked says so instead of listing nothing', async () => {
        sources = [];
        expect(await runContext(['read', 'nonsense'], env)).toBe(3);
        expect(stderr).toBe(['refused\tunknown-source\tnonsense is not linked to this session', 'note\tNothing is linked to this session'].join('\n') + '\n');
    });

    test('a daemon that fails or is not there stays a failure, not a refusal', async () => {
        expect(await runContext(['read', 'boom'], env)).toBe(1);
        const gone = { ...env, RUIMTE_CONTEXT_URL: 'http://127.0.0.1:1/context' };
        expect(await runContext(['read', 'n1'], gone)).toBe(1);
        expect(await runContext(['list'], gone)).toBe(1);
        expect(stderr).toInclude('Could not reach the daemon');
        expect(stdout).toBe('');
    });

    test('a verb posts its argv to /canvas/<verb> and prints the answer', async () => {
        expect(await runContext(['node', 'note', '--text', 'hello'], env)).toBe(0);
        expect(seen).toEqual([{ verb: 'node', argv: ['note', '--text', 'hello'], authorization: 'Bearer tok' }]);
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

    test('--text - takes the body from stdin, escaped so the daemon reads it back byte for byte', async () => {
        const body = 'Line one\nLine two\\n still one line\n';
        expect(await runContext(['node', 'note', '--text', '-'], env, async () => body)).toBe(0);
        expect(await runContext(['node', 'note', '--text=-'], env, async () => body)).toBe(0);
        const sent = seen.map((call) => call.argv);
        expect(sent[0]).toEqual(['note', '--text=Line one\nLine two\\\\n still one line\n']);
        expect(sent[1]).toEqual(sent[0]);
        expect(unescapeText((sent[0] as string[])[1]!.slice('--text='.length))).toBe(body);
    });

    test('a --text that is not a dash is passed on untouched, and stdin is never read', async () => {
        const stdin = async (): Promise<string> => {
            throw new Error('stdin was read');
        };
        expect(await runContext(['node', 'note', '--text', 'a\\nb', '--title', '-'], env, stdin)).toBe(0);
        expect(seen[0]!.argv).toEqual(['note', '--text', 'a\\nb', '--title', '-']);
    });

    test('a refusal exits 3 and goes to stderr', async () => {
        expect(await runContext(['nodes'], env)).toBe(3);
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
