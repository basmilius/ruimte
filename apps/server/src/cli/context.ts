import { parseRefusalBody, refusalBody, type ParsedRefusal } from '@adecore/agents/context';
import { escapeText } from '../canvas/text-escapes.ts';
import { flagValue, stdinWords, takeAll } from './flags.ts';

// Exit codes distinguish daemon failures, stale sessions and command refusals for callers that script this CLI.
export async function runContext(args: string[], env: Environment = process.env, stdin: () => Promise<string> = () => Bun.stdin.text()): Promise<number> {
    const url = env.RUIMTE_CONTEXT_URL;
    const token = env.RUIMTE_CONTEXT_TOKEN ?? env.RUIMTE_HOOK_TOKEN;
    if (!url || !token) {
        console.error('Not inside a Ruimte session: RUIMTE_CONTEXT_URL and a token are missing.');
        return 2;
    }

    const [command = 'list', id] = args;
    const headers = { authorization: `Bearer ${token}` };

    if (command === 'list') {
        return runList(url, headers, env);
    }
    if (command === 'read') {
        return runRead(url, id, args.slice(2), headers, env);
    }
    const canvasUrl = url.replace(/\/context\/?$/, '/canvas');
    if (command === 'visual' && (args[1] === 'show' || args[1] === 'preview')) {
        return runVisualPage(canvasUrl, args[1], await withStdinFlag(args.slice(2), 'html', stdin), headers, env);
    }
    if (command === 'chat' && args[1] === 'attach') {
        return runChatAttach(canvasUrl, args.slice(2), headers, env);
    }
    if (command === 'artifact' && args[1] === 'publish') {
        return runArtifactPublish(canvasUrl, args.slice(2), headers, env);
    }
    return runVerb(canvasUrl, command, await verbArgv(command, args, stdin), headers, env);
}

/* The words a verb takes, with whatever it reads from stdin put in its flag. */
async function verbArgv(command: string, args: string[], stdin: () => Promise<string>): Promise<string[]> {
    const rest = args.slice(2);
    if (command === 'visual' && args[1] === 'write') {
        return ['write', ...(await withStdinFlag(rest, 'html', stdin))];
    }
    if (command === 'view' && args[1] === 'diagram') {
        return ['diagram', ...(await withStdinFlag(rest, 'document', stdin))];
    }
    if (command === 'view' && args[1] === 'drawing') {
        return ['drawing', ...(await withStdinFlag(rest, 'edit', stdin))];
    }
    if (command === 'database' && (args[1] === 'query' || args[1] === 'execute')) {
        return [args[1], ...(await withStdinFlag(rest, 'sql', stdin))];
    }
    if (command === 'plan' && args[1] === 'new') {
        return ['new', ...(await withStdinPlan(rest, stdin))];
    }
    if (command === 'node' && (args[1] === 'new' || args[1] === 'edit' || args[1] === 'rename')) {
        return [args[1], ...(await withStdinJson(rest, stdin))];
    }
    return withStdinText(args.slice(1), stdin);
}

async function runList(url: string, headers: Record<string, string>, env: Environment): Promise<number> {
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
        console.log(`${source.id}\t${source.kind}\t${source.title}\t${source.flag ?? '-'}\t${source.snoozedUntil ?? '-'}`);
    }
    return 0;
}

async function runRead(url: string, id: string | undefined, flags: string[], headers: Record<string, string>, env: Environment): Promise<number> {
    if (!id) {
        return refuse('bad-arguments', 'read takes the id of a linked source', [READ_USAGE, READ_HELP, ...(await linkedLines(url, headers, env))]);
    }
    const tail = tailOf(flags);
    if (tail === 'bad') {
        return refuse('bad-arguments', '--tail needs a positive whole number of lines', [READ_USAGE, READ_HELP]);
    }
    const subagent = flagValue(flags, 'subagent');
    if (subagent === '') {
        return refuse('bad-arguments', '--subagent needs the id from a > Subagent line of the chat', [READ_USAGE, READ_HELP]);
    }
    const view = flagValue(flags, 'view');
    if (view === '') {
        return refuse('bad-arguments', '--view needs the id of the canvas the source stands on', [READ_USAGE, READ_HELP]);
    }
    const project = flagValue(flags, 'project');
    if (project === '') {
        return refuse('bad-arguments', '--project needs the id of a project; ruimte-context project list lists them', [READ_USAGE, READ_HELP]);
    }
    const elements = flags.includes('--elements');
    const image = flags.includes('--image');
    if (elements && image) {
        return refuse('bad-arguments', 'read takes --elements or --image, not both', [READ_USAGE, READ_HELP]);
    }
    const query = new URLSearchParams();
    if (view !== null) {
        query.set('view', view);
    }
    if (project !== null) {
        query.set('project', project);
    }
    if (elements || image) {
        query.set('form', elements ? 'elements' : 'image');
    }
    if (tail !== null) {
        query.set('tail', String(tail));
    }
    if (subagent !== null) {
        query.set('subagent', subagent);
    }
    const json = flags.includes('--json');
    if (json) {
        query.set('json', '');
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
        // Only the daemon has the canvas the id may be a node on, so it says which no this is.
        const { code, message, lines } = readRefusal(await response.text(), id);
        return refuse(code, message, [...(await linkedLines(url, headers, env)), ...lines]);
    }
    if (response.status === 422) {
        // A refusal of the form asked for arrives whole; anything else is the sentence about a subagent.
        const body = await response.text();
        const parsed = parseRefusalBody(body);
        return parsed ? refuse(parsed.code, parsed.message, parsed.lines) : refuse('unknown-subagent', body, [READ_USAGE, READ_HELP]);
    }
    if (!response.ok) {
        console.error(`The daemon answered ${response.status}`);
        return 1;
    }
    process.stdout.write(`${json ? await readJson(response) : await response.text()}\n`);
    return 0;
}

/* A daemon from before `--json` answers the text alone, which then stands as the one field it would have had. */
async function readJson(response: Response): Promise<string> {
    const body = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : { text: await response.text() };
    return JSON.stringify(body, null, 2);
}

/*
 * A page's local images go in here, in the agent's own process, so the daemon never reads a path an
 * agent names. Imported only for these two, so no other verb pays for loading the contracts.
 */
async function runVisualPage(
    canvasUrl: string,
    action: 'show' | 'preview',
    argv: string[],
    headers: Record<string, string>,
    env: Environment
): Promise<number> {
    const { prepareVisualPage } = await import('./visual-images.ts');
    const prepared = await prepareVisualPage(action, argv);
    if ('refusal' in prepared) {
        return refuse(prepared.refusal.code, prepared.refusal.message, prepared.refusal.lines);
    }
    const code = await runVerb(canvasUrl, 'visual', [action, ...prepared.argv], headers, env);
    if (code === 0 && prepared.lines.length > 0) {
        process.stdout.write(`${prepared.lines.join('\n')}\n`);
    }
    return code;
}

/*
 * `chat attach` reads its file here, like a page's local images, and sends the bytes: the daemon
 * never opens a path an agent names.
 */
async function runChatAttach(canvasUrl: string, argv: string[], headers: Record<string, string>, env: Environment): Promise<number> {
    const file = flagValue(argv, 'file');
    if (file === null || file === '') {
        return refuse('bad-arguments', 'chat attach needs --file <path>, an image or model file of your own', [
            'usage\tchat attach\t--file <path> [--name N]',
            'detail\truimte-context help chat attach'
        ]);
    }
    const { prepareAttachment } = await import('./chat-attach.ts');
    // The file and the name are read here; every other word goes on to the daemon.
    const prepared = await prepareAttachment(file, flagValue(argv, 'name'), takeAll(takeAll(argv, 'file').rest, 'name').rest);
    if ('refusal' in prepared) {
        return refuse(prepared.refusal.code, prepared.refusal.message, prepared.refusal.lines);
    }
    return runVerb(canvasUrl, 'chat', ['attach', ...prepared.argv], headers, env);
}

/* `artifact publish` sends its files from here, in raw pieces, and only then asks the daemon to keep them. */
async function runArtifactPublish(canvasUrl: string, argv: string[], headers: Record<string, string>, env: Environment): Promise<number> {
    const { prepareArtifactPublish } = await import('./artifact-publish.ts');
    const prepared = await prepareArtifactPublish(canvasUrl, argv, headers);
    if ('refusal' in prepared) {
        return refuse(prepared.refusal.code, prepared.refusal.message, prepared.refusal.lines);
    }
    if ('failure' in prepared) {
        console.error(prepared.failure);
        return 1;
    }
    if ('unreachable' in prepared) {
        console.error(unreachable(prepared.unreachable, env));
        return 1;
    }
    return runVerb(canvasUrl, 'artifact', ['publish', ...prepared.argv], headers, env);
}

/*
 * `view diagram` takes its document, `visual write`, `show` and `preview` a page and `database query` and
 * `database execute` their SQL on stdin, which the daemon never sees, so it travels as `--document`,
 * `--html` or `--sql`. Not escaped the way `--text` is: the daemon reads no escapes there. The flag
 * already given means stdin is not the source, so it is left unread.
 */
async function withStdinFlag(argv: string[], flag: string, stdin: () => Promise<string>): Promise<string[]> {
    if (argv.some((word) => word === `--${flag}` || word.startsWith(`--${flag}=`))) {
        return argv;
    }
    return [...argv, `--${flag}=${await stdin()}`];
}

/*
 * `plan new` takes its plan on stdin like `view diagram`: JSON as `--document`, or a Markdown list as
 * `--markdown -`. Both arrive untouched, since the daemon parses them and reads no escapes.
 */
async function withStdinPlan(argv: string[], stdin: () => Promise<string>): Promise<string[]> {
    for (let i = 0; i < argv.length; i++) {
        const taken = stdinWords(argv, i, '--markdown');
        if (taken > 0) {
            return [...argv.slice(0, i), `--markdown=${await stdin()}`, ...argv.slice(i + taken)];
        }
    }
    if (argv.some((word) => word.startsWith('--markdown') || word.startsWith('--document'))) {
        return argv;
    }
    return [...argv, `--document=${await stdin()}`];
}

interface ContextRow {
    id: string;
    kind: string;
    title: string;
    flag?: string;
    snoozedUntil?: string;
}

const READ_USAGE = 'usage\tread\t<id> [--tail N] [--subagent T] [--view V | --project P] [--elements | --image] [--json]';
const READ_HELP = 'detail\truimte-context help read';

/*
 * The `--tail N` of a read: the number, null when it was not asked for, and 'bad' for anything that is
 * not a positive whole number, so `--tail two` never arrives as a query nobody can read.
 */
function tailOf(argv: readonly string[]): number | null | 'bad' {
    const value = flagValue(argv, 'tail');
    if (value === null) {
        return null;
    }
    const count = Number(value);
    if (value === '' || !Number.isInteger(count) || count < 1) {
        return 'bad';
    }
    return count;
}

async function fetchSources(url: string, headers: Record<string, string>, env: Environment): Promise<ContextRow[]> {
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
}

/*
 * What `list` would have printed, under a refusal about a source. A daemon that cannot answer this
 * second question leaves the refusal without a list rather than turning it into a failure: the first
 * answer already said what the refusal is.
 */
async function linkedLines(url: string, headers: Record<string, string>, env: Environment): Promise<string[]> {
    const sources = await fetchSources(url, headers, env).catch(() => null);
    if (sources === null) {
        return [];
    }
    if (sources.length === 0) {
        return ['note\tNothing is linked to this session'];
    }
    return sources.map((source) => `${source.id}\t${source.kind}\t${source.title}`);
}

/*
 * A refused read, as the daemon wrote it: its code and sentence on the first line, what to do about
 * it under that. A daemon that answers something else leaves the sentence this side has always
 * written, so an older one still refuses a read rather than printing a body nobody can read.
 */
function readRefusal(body: string, id: string): ParsedRefusal {
    const parsed = parseRefusalBody(body);
    if (parsed) {
        return parsed;
    }
    // Whatever it did answer is the only reason there is; dropping it would leave a no without a why.
    const said = body.trim();
    const message = said === '' ? `${id} is not linked to this session` : `${id} could not be read: ${said}`;
    return { code: 'unknown-source', message, lines: [] };
}

/* `list`, `read` and a page's local images are the CLI's own, so it writes the refusal the daemon would have written for a verb. */
function refuse(code: string, message: string, lines: string[]): number {
    process.stderr.write(`${refusalBody(code, message, lines)}\n`);
    return 3;
}

/* A daemon that does not know the token: the session it was minted for is gone, so this is no session at all. */
class StaleToken extends Error {}

function staleToken(body: string): string {
    return `Not inside a live Ruimte session: the daemon answered 401${body.trim() ? ` ${body.trim()}` : ''}`;
}

type Environment = Record<string, string | undefined>;

/*
 * A sandboxed agent reads a refused connection as a daemon that is down and gives up, while the fix is
 * to run the same command with network access. Codex sets CODEX_SANDBOX in its sandbox and
 * CODEX_SANDBOX_NETWORK_DISABLED=1 when that sandbox has no network; other sandboxes say nothing.
 */
function unreachable(e: unknown, env: Environment): string {
    const reason = `Could not reach the daemon: ${e instanceof Error ? e.message : 'unknown error'}`;
    const retry = 'run the same command again with network access or escalated permissions';
    if (env.CODEX_SANDBOX_NETWORK_DISABLED === '1') {
        return `${reason}. This command runs in a sandbox without network access, which blocks the daemon's local address; ${retry}.`;
    }
    if (env.CODEX_SANDBOX) {
        return `${reason}. This command runs in a sandbox, which may block the daemon's local address; if so, ${retry}.`;
    }
    return `${reason}. A sandbox without network access is a common cause; if this command runs in one, ${retry}.`;
}

// The flags whose value `-` stands for stdin: a message, and the result of a task.
const STDIN_FLAGS = ['--text', '--result'];

/*
 * `--text -` (and `--result -`) is the CLI's own step: it puts what is on stdin in the argument, so a
 * heredoc gives a body with newlines and quotes in it. Escaped on the way out, because the daemon
 * reads `\n` in such a flag, and these bytes have to arrive as they were typed.
 */
async function withStdinText(argv: string[], stdin: () => Promise<string>): Promise<string[]> {
    const words: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const flag = STDIN_FLAGS.find((candidate) => stdinWords(argv, i, candidate) > 0);
        if (flag === undefined) {
            words.push(argv[i]!);
            continue;
        }
        words.push(`${flag}=${escapeText(await stdin())}`);
        i += stdinWords(argv, i, flag) - 1;
    }
    return words;
}

/* `--json -` on node new, edit and rename reads its array from stdin as it is: JSON has escapes of its own. */
async function withStdinJson(argv: string[], stdin: () => Promise<string>): Promise<string[]> {
    const words: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const taken = stdinWords(argv, i, '--json');
        if (taken === 0) {
            words.push(argv[i]!);
            continue;
        }
        words.push(`--json=${await stdin()}`);
        i += taken - 1;
    }
    return withStdinText(words, stdin);
}

async function runVerb(canvasUrl: string, verb: string, argv: string[], headers: Record<string, string>, env: Environment): Promise<number> {
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
}
