import { escapeText } from '../canvas/text-escapes.ts';

/*
 * `ruimte context`, reached through the `ruimte-context` script on every session's PATH. Reads
 * what the person linked to this agent on the canvas, and changes the canvas through the verbs the
 * daemon knows, with the address and the token from the environment the daemon gave the session.
 *
 *   ruimte-context                      lists the linked sources
 *   ruimte-context read <id>            prints one of them
 *   ruimte-context read <id> --tail N   prints its last N lines
 *   ruimte-context help                 lists all of the above and every canvas verb
 *   ruimte-context help <verb>          everything that one verb takes
 *   ruimte-context <verb> ...           runs one; the daemon parses the arguments
 *
 * Exit codes: 0 done, 1 the daemon could not be reached or failed, 2 not inside a session, 3 a
 * refusal (an unknown verb, bad arguments, a rule of the project, or a `read` of nothing linked).
 */
export const runContext = async (
    args: string[],
    env: Record<string, string | undefined> = process.env,
    stdin: () => Promise<string> = () => Bun.stdin.text()
): Promise<number> => {
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
            sources = await fetchSources(url, headers);
        } catch (e) {
            console.error(e instanceof Error ? e.message : 'The daemon failed');
            return 1;
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
                ...(await linkedLines(url, headers))
            ]);
        }
        const tail = tailOf(args.slice(2));
        if (tail === 'bad') {
            return refuse('bad-arguments', '--tail needs a positive whole number of lines', [READ_USAGE, 'detail\truimte-context help read']);
        }
        let response: Response;
        try {
            response = await fetch(`${url}/${encodeURIComponent(id)}${tail === null ? '' : `?tail=${tail}`}`, { headers });
        } catch (e) {
            console.error(unreachable(e));
            return 1;
        }
        if (response.status === 404) {
            return refuse('unknown-source', `${id} is not linked to this session`, await linkedLines(url, headers));
        }
        if (!response.ok) {
            console.error(`The daemon answered ${response.status}`);
            return 1;
        }
        process.stdout.write(`${await response.text()}\n`);
        return 0;
    }

    return runVerb(url.replace(/\/context\/?$/, '/canvas'), command, await withStdinText(args.slice(1), stdin), headers);
};

interface ContextRow {
    id: string;
    kind: string;
    title: string;
}

const READ_USAGE = 'usage\tread\t<id> [--tail N]';

/*
 * The `--tail N` of a read: the number, null when it was not asked for, and 'bad' for anything that
 * is not a positive whole number. The daemon does the counting, so this only has to be sure it is
 * sending a number at all rather than letting `--tail two` arrive as a query nobody can read.
 */
const tailOf = (argv: readonly string[]): number | null | 'bad' => {
    const index = argv.findIndex((word) => word === '--tail' || word.startsWith('--tail='));
    if (index === -1) {
        return null;
    }
    const word = argv[index]!;
    const value = word === '--tail' ? argv[index + 1] : word.slice('--tail='.length);
    const count = Number(value);
    if (value === undefined || value === '' || !Number.isInteger(count) || count < 1) {
        return 'bad';
    }
    return count;
};

const fetchSources = async (url: string, headers: Record<string, string>): Promise<ContextRow[]> => {
    let response: Response;
    try {
        response = await fetch(url, { headers });
    } catch (e) {
        throw new Error(unreachable(e));
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
const linkedLines = async (url: string, headers: Record<string, string>): Promise<string[]> => {
    const sources = await fetchSources(url, headers).catch(() => null);
    if (sources === null) {
        return [];
    }
    if (sources.length === 0) {
        return ['note\tNothing is linked to this session'];
    }
    return sources.map((source) => `${source.id}\t${source.kind}\t${source.title}`);
};

/* `list` and `read` are the CLI's own, so it writes the refusal the daemon would have written for a verb. */
const refuse = (code: string, message: string, lines: string[]): number => {
    process.stderr.write(`${[`refused\t${code}\t${message.replace(/[\t\r\n]+/g, ' ')}`, ...lines].join('\n')}\n`);
    return 3;
};

const unreachable = (e: unknown): string => `Could not reach the daemon: ${e instanceof Error ? e.message : 'unknown error'}`;

/*
 * `--text -` is the CLI's own step: it puts what is on stdin in the argument, so a heredoc gives a
 * body with newlines and quotes in it. Escaped on the way out, because the daemon reads `\n` in a
 * `--text` it is handed, and these bytes have to arrive as they were typed.
 */
const withStdinText = async (argv: string[], stdin: () => Promise<string>): Promise<string[]> => {
    const words: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]!;
        const pair = word === '--text' && argv[i + 1] === '-';
        if (!pair && word !== '--text=-') {
            words.push(word);
            continue;
        }
        words.push(`--text=${escapeText(await stdin())}`);
        if (pair) {
            i++;
        }
    }
    return words;
};

const runVerb = async (canvasUrl: string, verb: string, argv: string[], headers: Record<string, string>): Promise<number> => {
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
        console.error(unreachable(e));
        return 1;
    }
    if (response.ok) {
        process.stdout.write(body);
        return 0;
    }
    // 404 is a verb this daemon does not have, which is the same kind of no as bad arguments.
    if (response.status === 422 || response.status === 404) {
        process.stderr.write(body);
        return 3;
    }
    console.error(`The daemon answered ${response.status}${body ? `: ${body.trim()}` : ''}`);
    return 1;
};
