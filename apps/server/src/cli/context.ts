import { escapeText } from '../canvas/text-escapes.ts';
import { parseRefusalBody, refusalBody, type ParsedRefusal } from '../refusal.ts';

// Exit codes distinguish daemon failures, stale sessions and command refusals for callers that script this CLI.
export const runContext = async (args: string[], env: Environment = process.env, stdin: () => Promise<string> = () => Bun.stdin.text()): Promise<number> => {
    const url = env.RUIMTE_CONTEXT_URL;
    const token = env.RUIMTE_CONTEXT_TOKEN ?? env.RUIMTE_HOOK_TOKEN;
    if (!url || !token) {
        console.error('Not inside a Ruimte session: RUIMTE_CONTEXT_URL and a token are missing.');
        return 2;
    }

    const [command = 'list', id] = args;
    const headers = { authorization: `Bearer ${token}` };

    if (command === 'list') {
        let sources: ContextRow[];
        try {
            sources = await fetchSources(url, headers, env);
        } catch (e) {
            console.error(e instanceof Error ? e.message : 'The daemon failed');
            return e instanceof StaleToken ? 2 : 1;
        }
        if (sources.length === 0) {
            console.log('Nothing is linked to this session.');
        }
        for (const source of sources) {
            console.log(`${source.id}\t${source.kind}\t${source.title}`);
        }
        return 0;
    }

    if (command === 'read') {
        if (!id) {
            return refuse('bad-arguments', 'read takes the id of a linked source', [
                READ_USAGE,
                'detail\truimte-context help read',
                ...(await linkedLines(url, headers, env))
            ]);
        }
        const tail = tailOf(args.slice(2));
        if (tail === 'bad') {
            return refuse('bad-arguments', '--tail needs a positive whole number of lines', [READ_USAGE, 'detail\truimte-context help read']);
        }
        const subagent = flagValue(args.slice(2), 'subagent');
        if (subagent === '') {
            return refuse('bad-arguments', '--subagent needs the id from a > Subagent line of the chat', [READ_USAGE, 'detail\truimte-context help read']);
        }
        const query = new URLSearchParams();
        if (tail !== null) {
            query.set('tail', String(tail));
        }
        if (subagent !== null) {
            query.set('subagent', subagent);
        }
        let response: Response;
        try {
            response = await fetch(`${url}/${encodeURIComponent(id)}${query.size === 0 ? '' : `?${query}`}`, { headers });
        } catch (e) {
            console.error(unreachable(e, env));
            return 1;
        }
        if (response.status === 401) {
            console.error(staleToken(await response.text()));
            return 2;
        }
        if (response.status === 404) {
            /* The daemon says which no this is, since only it has the canvas the id may be a node on:
               a line running the other way is a different answer from an id nobody has drawn. */
            const { code, message, lines } = readRefusal(await response.text(), id);
            return refuse(code, message, [...(await linkedLines(url, headers, env)), ...lines]);
        }
        if (response.status === 422) {
            return refuse('unknown-subagent', await response.text(), [READ_USAGE, 'detail\truimte-context help read']);
        }
        if (!response.ok) {
            console.error(`The daemon answered ${response.status}`);
            return 1;
        }
        process.stdout.write(`${await response.text()}\n`);
        return 0;
    }

    const argv =
        command === 'view' && args[1] === 'diagram'
            ? ['diagram', ...(await withStdinDocument(args.slice(2), stdin))]
            : command === 'plan' && args[1] === 'new'
              ? ['new', ...(await withStdinPlan(args.slice(2), stdin))]
              : await withStdinText(args.slice(1), stdin);
    return runVerb(url.replace(/\/context\/?$/, '/canvas'), command, argv, headers, env);
};

/*
 * `view diagram` takes its document on stdin, which the daemon never sees, so it travels as `--document`.
 * Not escaped the way `--text` is: the daemon parses JSON here and reads no escapes of its own. A
 * `--document` already given means stdin is not the source, so it is left unread.
 */
const withStdinDocument = async (argv: string[], stdin: () => Promise<string>): Promise<string[]> => {
    if (argv.some((word) => word === '--document' || word.startsWith('--document='))) {
        return argv;
    }
    return [...argv, `--document=${await stdin()}`];
};

/*
 * `plan new` takes its plan on stdin like `view diagram`: JSON as `--document`, or a Markdown list as
 * `--markdown -`. Both arrive untouched, since the daemon parses them and reads no escapes.
 */
const withStdinPlan = async (argv: string[], stdin: () => Promise<string>): Promise<string[]> => {
    for (let i = 0; i < argv.length; i++) {
        const pair = argv[i] === '--markdown' && argv[i + 1] === '-';
        if (pair || argv[i] === '--markdown=-') {
            return [...argv.slice(0, i), `--markdown=${await stdin()}`, ...argv.slice(i + (pair ? 2 : 1))];
        }
    }
    if (argv.some((word) => word.startsWith('--markdown') || word.startsWith('--document'))) {
        return argv;
    }
    return [...argv, `--document=${await stdin()}`];
};

interface ContextRow {
    id: string;
    kind: string;
    title: string;
}

const READ_USAGE = 'usage\tread\t<id> [--tail N] [--subagent T]';

/* What follows `--name` or `--name=`: null when the flag is not there, empty when it has no value. */
const flagValue = (argv: readonly string[], name: string): string | null => {
    const index = argv.findIndex((word) => word === `--${name}` || word.startsWith(`--${name}=`));
    if (index === -1) {
        return null;
    }
    const word = argv[index]!;
    return (word === `--${name}` ? argv[index + 1] : word.slice(`--${name}=`.length)) ?? '';
};

/*
 * The `--tail N` of a read: the number, null when it was not asked for, and 'bad' for anything that
 * is not a positive whole number. The daemon does the counting, so this only has to be sure it is
 * sending a number at all rather than letting `--tail two` arrive as a query nobody can read.
 */
const tailOf = (argv: readonly string[]): number | null | 'bad' => {
    const value = flagValue(argv, 'tail');
    if (value === null) {
        return null;
    }
    const count = Number(value);
    if (value === '' || !Number.isInteger(count) || count < 1) {
        return 'bad';
    }
    return count;
};

const fetchSources = async (url: string, headers: Record<string, string>, env: Environment): Promise<ContextRow[]> => {
    let response: Response;
    try {
        response = await fetch(url, { headers });
    } catch (e) {
        throw new Error(unreachable(e, env));
    }
    if (response.status === 401) {
        throw new StaleToken(staleToken(await response.text()));
    }
    if (!response.ok) {
        throw new Error(`The daemon answered ${response.status}`);
    }
    const { sources } = (await response.json()) as { sources: ContextRow[] };
    return sources;
};

/*
 * What `list` would have printed, under a refusal about a source. A daemon that cannot answer this
 * second question leaves the refusal without a list rather than turning it into a failure: the first
 * answer already said what the refusal is.
 */
const linkedLines = async (url: string, headers: Record<string, string>, env: Environment): Promise<string[]> => {
    const sources = await fetchSources(url, headers, env).catch(() => null);
    if (sources === null) {
        return [];
    }
    if (sources.length === 0) {
        return ['note\tNothing is linked to this session'];
    }
    return sources.map((source) => `${source.id}\t${source.kind}\t${source.title}`);
};

/*
 * A refused read, as the daemon wrote it: its code and sentence on the first line, what to do about
 * it under that. A daemon that answers something else leaves the sentence this side has always
 * written, so an older one still refuses a read rather than printing a body nobody can read.
 */
const readRefusal = (body: string, id: string): ParsedRefusal => {
    const parsed = parseRefusalBody(body);
    if (parsed) {
        return parsed;
    }
    // Whatever it did answer is the only reason there is; dropping it would leave a no without a why.
    const said = body.trim();
    const message = said === '' ? `${id} is not linked to this session` : `${id} could not be read: ${said}`;
    return { code: 'unknown-source', message, lines: [] };
};

/* `list` and `read` are the CLI's own, so it writes the refusal the daemon would have written for a verb. */
const refuse = (code: string, message: string, lines: string[]): number => {
    process.stderr.write(`${refusalBody(code, message, lines)}\n`);
    return 3;
};

/* A daemon that does not know the token: the session it was minted for is gone, so this is no session at all. */
class StaleToken extends Error {}

const staleToken = (body: string): string => `Not inside a live Ruimte session: the daemon answered 401${body.trim() ? ` ${body.trim()}` : ''}`;

type Environment = Record<string, string | undefined>;

/*
 * A sandboxed agent reads a refused connection as a daemon that is down and gives up, while the fix is
 * to run the same command with network access. Codex sets CODEX_SANDBOX in its sandbox and
 * CODEX_SANDBOX_NETWORK_DISABLED=1 when that sandbox has no network; other sandboxes say nothing.
 */
const unreachable = (e: unknown, env: Environment): string => {
    const reason = `Could not reach the daemon: ${e instanceof Error ? e.message : 'unknown error'}`;
    const retry = 'run the same command again with network access or escalated permissions';
    if (env.CODEX_SANDBOX_NETWORK_DISABLED === '1') {
        return `${reason}. This command runs in a sandbox without network access, which blocks the daemon's local address; ${retry}.`;
    }
    if (env.CODEX_SANDBOX) {
        return `${reason}. This command runs in a sandbox, which may block the daemon's local address; if so, ${retry}.`;
    }
    return `${reason}. A sandbox without network access is a common cause; if this command runs in one, ${retry}.`;
};

// The flags whose value `-` stands for stdin: a message, and the result of a task.
const STDIN_FLAGS = ['--text', '--result'];

/*
 * `--text -` (and `--result -`) is the CLI's own step: it puts what is on stdin in the argument, so a
 * heredoc gives a body with newlines and quotes in it. Escaped on the way out, because the daemon
 * reads `\n` in such a flag, and these bytes have to arrive as they were typed.
 */
const withStdinText = async (argv: string[], stdin: () => Promise<string>): Promise<string[]> => {
    const words: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]!;
        const flag = STDIN_FLAGS.find((candidate) => word === candidate || word === `${candidate}=-`);
        const pair = flag !== undefined && word === flag && argv[i + 1] === '-';
        if (flag === undefined || (!pair && word !== `${flag}=-`)) {
            words.push(word);
            continue;
        }
        words.push(`${flag}=${escapeText(await stdin())}`);
        if (pair) {
            i++;
        }
    }
    return words;
};

const runVerb = async (canvasUrl: string, verb: string, argv: string[], headers: Record<string, string>, env: Environment): Promise<number> => {
    let response: Response;
    let body: string;
    try {
        response = await fetch(`${canvasUrl}/${encodeURIComponent(verb)}`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ argv })
        });
        body = await response.text();
    } catch (e) {
        console.error(unreachable(e, env));
        return 1;
    }
    if (response.ok) {
        process.stdout.write(body);
        return 0;
    }
    if (response.status === 401) {
        console.error(staleToken(body));
        return 2;
    }
    // 404 is a verb this daemon does not have, which is the same kind of no as bad arguments.
    if (response.status === 422 || response.status === 404) {
        process.stderr.write(body);
        return 3;
    }
    console.error(`The daemon answered ${response.status}${body ? `: ${body.trim()}` : ''}`);
    return 1;
};
