import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    parseServerFrame,
    type EndpointInfo,
    type PairResult,
    type FsBrowseResult,
    type FsListResult,
    type GitStatus,
    type ProjectListResult,
    type ProjectOpenResult,
    type ServerHelloResult,
    type SessionAttachResult,
    type SessionInfo
} from '@ruimte/contracts';

/*
 * The daemon from `apps/server/docker`, talked to the way a client would: over the wire, from
 * another machine. It needs a container listening on a real port, so it only runs when someone
 * asks for it; `bun test` on this repository (and in CI) stays a run of unit tests.
 *
 *   bun run --cwd apps/server docker:up
 *   bun run --cwd apps/server docker:test
 */
const ENABLED = process.env.RUIMTE_DOCKER === '1';

const CONTAINER = process.env.RUIMTE_DOCKER_CONTAINER ?? 'ruimte-remote';
// The compose file maps this port straight through, so it names the daemon on both sides.
const PORT = Number(process.env.RUIMTE_DOCKER_PORT ?? 4310);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPO = '/work/atlas';
const HOME = '/root/.ruimte';

interface Pending {
    resolve(value: unknown): void;
    reject(reason: Error): void;
}

/* The client side of the wire, small enough to be obviously right: one socket, ids and events. */
class RemoteClient {
    /* Whether the daemon on the other end went away, which is the whole point of the pool's tests. */
    closed = false;
    private readonly socket: WebSocket;
    private readonly pending = new Map<string, Pending>();
    private readonly output: string[] = [];
    private readonly events = new Map<string, unknown[]>();
    private nextId = 1;

    private constructor(socket: WebSocket) {
        this.socket = socket;
        socket.onmessage = (message) => this.receive(String(message.data));
        socket.onclose = () => {
            this.closed = true;
            const waiting = [...this.pending.values()];
            this.pending.clear();
            for (const entry of waiting) {
                entry.reject(new Error('disconnected'));
            }
        };
    }

    static async connect(token: string | null, port: number = PORT): Promise<RemoteClient> {
        const query = token === null ? '' : `?token=${encodeURIComponent(token)}`;
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
        await new Promise<void>((resolve, reject) => {
            socket.onopen = () => resolve();
            socket.onclose = (event) => reject(new Error(`The daemon closed the socket: ${event.code} ${event.reason}`));
        });
        return new RemoteClient(socket);
    }

    close(): void {
        this.socket.close();
    }

    request<T>(type: string, payload: unknown): Promise<T> {
        const id = `r${this.nextId++}`;
        // The executor runs now, so the reply has somewhere to land before the frame goes out.
        const reply = new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
        });
        this.socket.send(JSON.stringify({ id, type, payload }));
        return reply;
    }

    /* Everything the daemon wrote on `session.output` since the last read. */
    takeOutput(): string {
        return this.output.splice(0).join('');
    }

    /* The payloads of one event since the last read; a client keeps only what a test asked about. */
    takeEvents<T>(event: string): T[] {
        return (this.events.get(event)?.splice(0) ?? []) as T[];
    }

    private receive(raw: string): void {
        const parsed = parseServerFrame(JSON.parse(raw));
        if (!parsed.ok) {
            throw new Error(`The daemon sent a frame this client cannot read: ${parsed.message}`);
        }
        const frame = parsed.value;
        if (!('ok' in frame)) {
            if (frame.event === 'session.output') {
                this.output.push((frame.payload as { data: string }).data);
                return;
            }
            const seen = this.events.get(frame.event) ?? [];
            seen.push(frame.payload);
            this.events.set(frame.event, seen);
            return;
        }
        const pending = frame.id === null ? undefined : this.pending.get(frame.id);
        if (!pending || frame.id === null) {
            return;
        }
        this.pending.delete(frame.id);
        if (frame.ok) {
            pending.resolve(frame.result);
        } else {
            pending.reject(new Error(`${frame.error.code}: ${frame.error.message}`));
        }
    }
}

const waitUntil = async (label: string, ready: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!(await ready())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await Bun.sleep(100);
    }
};

/* What the command wrote on the other machine, for the things no request answers. */
const inContainer = async (command: string[]): Promise<string> =>
    (await new Response(Bun.spawn(['docker', 'exec', CONTAINER, ...command], { stderr: 'inherit' }).stdout).text()).trim();

/*
 * A pairing token goes only to a client on the daemon's own machine, so the ask happens inside
 * the container. The URL it prints names the container, which nothing here resolves; only the
 * token behind the fragment travels back to the host.
 */
const pair = async (): Promise<PairResult> => {
    const printed = await inContainer(['bun', '/app/apps/server/src/main.ts', 'pair', '--port', String(PORT)]);
    const token = printed.split('\n').at(-1)?.split('#').at(-1) ?? '';
    if (!token) {
        throw new Error(`No pairing token in what \`ruimte pair\` printed: ${printed}`);
    }
    const response = await fetch(`${BASE_URL}/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, label: 'docker test' })
    });
    if (!response.ok) {
        throw new Error(`Pairing failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as PairResult;
};

describe.skipIf(!ENABLED)('the daemon in the Linux container', () => {
    let client: RemoteClient;
    let paired: PairResult;
    let sessionToken: string;
    const openedProjects: string[] = [];
    const startedSessions: string[] = [];

    beforeAll(async () => {
        const answers = async (): Promise<boolean> => {
            const response = await fetch(`${BASE_URL}/health`).catch(() => null);
            return response?.ok === true;
        };
        // A container started a second ago is still writing its repositories; anything longer is a container that is not there.
        await waitUntil(`a daemon on ${BASE_URL}; start one with \`bun run --cwd apps/server docker:up\``, answers, 5_000);
        paired = await pair();
        sessionToken = paired.sessionToken;
        client = await RemoteClient.connect(sessionToken);
    });

    afterAll(async () => {
        for (const sessionId of startedSessions) {
            await client?.request('session.kill', { sessionId }).catch(() => undefined);
        }
        for (const projectId of openedProjects) {
            await client?.request('project.delete', { projectId, removeFiles: true }).catch(() => undefined);
        }
        client?.close();
    });

    test('the container answers on the mapped port', async () => {
        const response = await fetch(`${BASE_URL}/health`);
        const health = (await response.json()) as { ok: boolean; version: string };
        expect(health.ok).toBe(true);
        expect(health.version.length).toBeGreaterThan(0);
    });

    test('pairing hands out a session token that opens a socket', async () => {
        expect(sessionToken.length).toBeGreaterThan(20);
        const second = await RemoteClient.connect(sessionToken);
        second.close();
    });

    test('an unknown token gets nowhere', async () => {
        const response = await fetch(`${BASE_URL}/ws?token=not-a-token`);
        expect(response.status).toBe(401);
    });

    test('server.hello reports a Linux daemon', async () => {
        const hello = await client.request<ServerHelloResult>('server.hello', {});
        expect(hello.platform).toBe('linux');
        expect(hello.home).toBe('/root/.ruimte');
        expect(hello.version.length).toBeGreaterThan(0);
    });

    test('endpoint.info knows the client is not on its machine', async () => {
        const info = await client.request<EndpointInfo>('endpoint.info', {});
        expect(info.platform).toBe('linux');
        expect(info.label).toBe('docker-linux');
        expect(info.authenticated).toBe(true);
        // Docker forwards the port through its own gateway, so the daemon sees a private address.
        expect(info.reachability).toBe('lan');
    });

    test('the pairing answer and endpoint.info name the same daemon', async () => {
        const info = await client.request<EndpointInfo>('endpoint.info', {});
        expect(info.id.length).toBeGreaterThan(8);
        // The row a client keeps is built from the pairing answer, so the id has to be in it too.
        expect(paired.endpoint.id).toBe(info.id);
    });

    test('the daemon keeps its id in its home, so a restart finds the same machine', async () => {
        const info = await client.request<EndpointInfo>('endpoint.info', {});
        expect(JSON.parse(await inContainer(['cat', `${HOME}/endpoint.json`]))).toEqual({ version: 1, id: info.id });
        /*
         * What a second start would do, run against the home of the daemon that is up. A real
         * `docker restart` throws that home away (`docker/entrypoint.sh`, `RUIMTE_KEEP_STATE`), so
         * it would test the harness instead of the daemon.
         */
        const restarted = await inContainer([
            'bun',
            '-e',
            `import { readOrCreateEndpointId } from '/app/apps/server/src/endpoint-id.ts'; console.log(await readOrCreateEndpointId('${HOME}'));`
        ]);
        expect(restarted).toBe(info.id);
    });

    test('a client on another machine cannot mint a pairing link', async () => {
        await expect(client.request('auth.pairingToken', {})).rejects.toThrow(/forbidden/);
    });

    test('a fresh daemon lists no projects', async () => {
        const listed = await client.request<ProjectListResult>('project.list', {});
        expect(listed.projects.some((project) => project.folder === REPO)).toBe(false);
    });

    test('a project opens on a repository in /work', async () => {
        const opened = await client.request<ProjectOpenResult>('project.open', { folder: REPO, name: 'Atlas' });
        openedProjects.push(opened.summary.projectId);
        expect(opened.summary.folder).toBe(REPO);
        expect(opened.document.views.length).toBeGreaterThan(0);

        const listed = await client.request<ProjectListResult>('project.list', {});
        expect(listed.projects.some((project) => project.projectId === opened.summary.projectId)).toBe(true);
    });

    test('a terminal session runs a shell in the repository', async () => {
        const sessionId = `docker-test-${Date.now()}`;
        const info = await client.request<SessionInfo>('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        startedSessions.push(sessionId);
        expect(info.pid).toBeGreaterThan(0);
        expect(info.cwd).toBe(REPO);
        expect(info.exited).toBe(false);

        const attached = await client.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
        expect(attached.exited).toBe(false);

        let seen = '';
        await client.request('session.write', { sessionId, data: 'uname -s && pwd\n' });
        await waitUntil('the shell to answer', () => {
            seen += client.takeOutput();
            return seen.includes('Linux') && seen.includes(REPO);
        });
    });

    test('git.status sees the work left in the repository', async () => {
        const status = await client.request<GitStatus>('git.status', { cwd: REPO });
        expect(status.repo).toBe(true);
        expect(status.root).toBe(REPO);
        expect(status.branch).toBe('main');
        expect(status.detached).toBe(false);
        expect(status.files.find((file) => file.path === 'README.md')?.state).toBe('unstaged');
        expect(status.files.find((file) => file.path === 'notes.txt')?.state).toBe('untracked');
    });

    test('fs.browse lists the repositories on the remote machine', async () => {
        const browsed = await client.request<FsBrowseResult>('fs.browse', { partialPath: '/work/' });
        expect(browsed.parentPath).toBe('/work');
        expect(browsed.entries.map((entry) => entry.name).sort()).toEqual(['atlas', 'beacon']);
        expect(browsed.exists).toBe(true);
    });

    test('a path that is not on that machine comes back as not there', async () => {
        const browsed = await client.request<FsBrowseResult>('fs.browse', { partialPath: '/work/nowhere/' });
        expect(browsed.parentPath).toBe('/work/nowhere');
        expect(browsed.entries).toEqual([]);
        expect(browsed.exists).toBe(false);
    });

    test('createFolder makes the folder on the machine that was asked, not on this one', async () => {
        const folder = '/work/fresh/nested';
        const opened = await client.request<ProjectOpenResult>('project.open', { folder, createFolder: true });
        openedProjects.push(opened.summary.projectId);
        expect(opened.summary.folder).toBe(folder);
        expect(await inContainer(['sh', '-c', `test -d ${folder} && echo yes`])).toBe('yes');
        // A daemon on this machine would have made the same path here, which is what this rules out.
        expect(await Bun.file(folder).exists()).toBe(false);

        const browsed = await client.request<FsBrowseResult>('fs.browse', { partialPath: '/work/fresh/' });
        expect(browsed.entries.map((entry) => entry.name)).toEqual(['nested']);
        expect(browsed.exists).toBe(true);
        await inContainer(['rm', '-rf', '/work/fresh']);
    });
});

/* Starts or stops the container itself, for the half of the pool that is about a daemon falling away. */
const docker = async (args: string[]): Promise<void> => {
    const exit = await Bun.spawn(['docker', ...args], { stdout: 'ignore', stderr: 'inherit' }).exited;
    if (exit !== 0) {
        throw new Error(`docker ${args.join(' ')} exited with ${exit}`);
    }
};

const answers = async (url: string): Promise<boolean> => (await fetch(`${url}/health`).catch(() => null))?.ok === true;

/*
 * Two daemons at once, which is what the client's transport pool holds: a socket per machine, each
 * with a reconnect loop of its own. The second daemon is a plain one on this machine, so the one
 * that has to keep working is not the one being stopped. The container is left running.
 */
describe.skipIf(!ENABLED)('two daemons at the same time', () => {
    const LOCAL_PORT = Number(process.env.RUIMTE_LOCAL_PORT ?? 4311);
    const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
    let daemon: ReturnType<typeof Bun.spawn> | null = null;
    let home = '';
    let here: RemoteClient;
    let there: RemoteClient;
    const startedSessions: string[] = [];

    beforeAll(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-pool-'));
        // Its own home and no hooks: a test daemon must leave this machine's state and CLI settings alone.
        daemon = Bun.spawn(
            ['bun', join(import.meta.dir, '../main.ts'), '--host', '127.0.0.1', '--port', String(LOCAL_PORT), '--no-hooks', '--no-price-fetch'],
            { env: { ...process.env, RUIMTE_HOME: home }, stdout: 'ignore', stderr: 'inherit' }
        );
        await waitUntil(`a second daemon on ${LOCAL_URL}`, () => answers(LOCAL_URL));
        await waitUntil(`the container on ${BASE_URL}`, () => answers(BASE_URL), 5_000);
        // A daemon on this machine needs no token; the one in the container does.
        here = await RemoteClient.connect(null, LOCAL_PORT);
        there = await RemoteClient.connect((await pair()).sessionToken);
    }, 60_000);

    afterAll(async () => {
        for (const sessionId of startedSessions) {
            await here?.request('session.kill', { sessionId }).catch(() => undefined);
        }
        here?.close();
        there?.close();
        daemon?.kill();
        await daemon?.exited;
        await rm(home, { recursive: true, force: true });
    });

    test('both machines answer at once, each about itself', async () => {
        const [mine, theirs] = await Promise.all([here.request<ServerHelloResult>('server.hello', {}), there.request<ServerHelloResult>('server.hello', {})]);
        expect(mine.platform).toBe(process.platform);
        expect(mine.home).toBe(home);
        expect(theirs.platform).toBe('linux');
        expect(theirs.home).toBe(HOME);

        const [mineInfo, theirsInfo] = await Promise.all([here.request<EndpointInfo>('endpoint.info', {}), there.request<EndpointInfo>('endpoint.info', {})]);
        // Two rows in the client's endpoint list only stay two rows because the ids differ.
        expect(mineInfo.id).not.toBe(theirsInfo.id);
        expect(mineInfo.reachability).toBe('loopback');
        expect(theirsInfo.reachability).toBe('lan');
    });

    test('a shell on each machine runs on the machine it was started on', async () => {
        const mine = `pool-here-${Date.now()}`;
        const theirs = `pool-there-${Date.now()}`;
        startedSessions.push(mine);
        await here.request('session.create', { sessionId: mine, cwd: home, cols: 80, rows: 24 });
        await here.request('session.attach', { sessionId: mine, cols: 80, rows: 24 });
        await there.request('session.create', { sessionId: theirs, cwd: REPO, cols: 80, rows: 24 });
        await there.request('session.attach', { sessionId: theirs, cols: 80, rows: 24 });

        await here.request('session.write', { sessionId: mine, data: 'uname -s\n' });
        await there.request('session.write', { sessionId: theirs, data: 'uname -s\n' });
        let mineSaid = '';
        let theirsSaid = '';
        await waitUntil('both shells to answer', () => {
            mineSaid += here.takeOutput();
            theirsSaid += there.takeOutput();
            return mineSaid.includes('Darwin') && theirsSaid.includes('Linux');
        });
        // The sessions of one machine never show up on the other; the daemons know nothing of each other.
        const listed = await there.request<{ sessions: SessionInfo[] }>('session.list', {});
        expect(listed.sessions.some((session) => session.sessionId === mine)).toBe(false);
    });

    test('the container falling away leaves the daemon on this machine untouched', async () => {
        const sessionId = `pool-survivor-${Date.now()}`;
        startedSessions.push(sessionId);
        await here.request('session.create', { sessionId, cwd: home, cols: 80, rows: 24 });
        await here.request('session.attach', { sessionId, cols: 80, rows: 24 });
        here.takeOutput();

        await docker(['stop', '--time', '5', CONTAINER]);
        await waitUntil('the socket to the container to notice', () => there.closed);

        expect(here.closed).toBe(false);
        await here.request('session.write', { sessionId, data: 'echo still-here\n' });
        let said = '';
        await waitUntil('the shell on this machine to answer with the container gone', () => {
            said += here.takeOutput();
            return said.includes('still-here');
        });
        const hello = await here.request<ServerHelloResult>('server.hello', {});
        expect(hello.home).toBe(home);
    }, 60_000);

    /*
     * What the project menu does with a machine that is not there: the union is per machine, so the
     * one that is up keeps listing and opening its own projects while the other one is away.
     */
    test('a project on the machine that is up opens while the other one is gone', async () => {
        const opened = await here.request<ProjectOpenResult>('project.open', { name: 'While the container is down' });
        const listed = await here.request<ProjectListResult>('project.list', {});
        expect(listed.projects.some((project) => project.projectId === opened.summary.projectId)).toBe(true);
        expect(there.closed).toBe(true);
    });

    test('the container comes back and pairs again, next to the connection that never dropped', async () => {
        await docker(['start', CONTAINER]);
        await waitUntil(`the container on ${BASE_URL} again`, () => answers(BASE_URL), 60_000);

        const back = await RemoteClient.connect((await pair()).sessionToken);
        const info = await back.request<EndpointInfo>('endpoint.info', {});
        expect(info.platform).toBe('linux');
        expect(back.closed).toBe(false);
        expect(here.closed).toBe(false);
        back.close();
    }, 90_000);
});

/*
 * The same node id, the same absolute path and the same request on two machines at once, which is
 * what the client's stores are keyed for. Every answer here has to be about the daemon it was asked
 * of and about nothing else; a client that mixed two of them would show one machine's screen on the
 * other machine's node.
 */
describe.skipIf(!ENABLED)('one id on two machines', () => {
    const LOCAL_PORT = Number(process.env.RUIMTE_LOCAL_PORT ?? 4312);
    const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
    /* A path that exists on both machines, so a key on the path alone would hold one checkout for two. */
    const SHARED = '/tmp/ruimte-two-machines';
    let daemon: ReturnType<typeof Bun.spawn> | null = null;
    let home = '';
    let here: RemoteClient;
    let there: RemoteClient;
    const startedSessions: string[] = [];

    const seedRepo = async (run: (command: string[]) => Promise<unknown>, branch: string, file: string): Promise<void> => {
        await run(['sh', '-c', `rm -rf ${SHARED} && mkdir -p ${SHARED}`]);
        await run([
            'sh',
            '-c',
            `cd ${SHARED} && git init -q -b ${branch} && git config user.email t@t && git config user.name t && ` +
                `echo one > ${file} && git add -A && git commit -q -m first && echo two >> ${file}`
        ]);
    };

    beforeAll(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-scope-'));
        daemon = Bun.spawn(
            ['bun', join(import.meta.dir, '../main.ts'), '--host', '127.0.0.1', '--port', String(LOCAL_PORT), '--no-hooks', '--no-price-fetch'],
            { env: { ...process.env, RUIMTE_HOME: home }, stdout: 'ignore', stderr: 'inherit' }
        );
        await waitUntil(`a second daemon on ${LOCAL_URL}`, () => answers(LOCAL_URL));
        await waitUntil(`the container on ${BASE_URL}`, () => answers(BASE_URL), 5_000);
        here = await RemoteClient.connect(null, LOCAL_PORT);
        there = await RemoteClient.connect((await pair()).sessionToken);
        await seedRepo(async (command) => Bun.spawn(command, { stdout: 'ignore', stderr: 'inherit' }).exited, 'here', 'mine.txt');
        await seedRepo((command) => inContainer(command), 'there', 'theirs.txt');
    }, 60_000);

    afterAll(async () => {
        for (const sessionId of startedSessions) {
            await here?.request('session.kill', { sessionId }).catch(() => undefined);
            await there?.request('session.kill', { sessionId }).catch(() => undefined);
        }
        here?.close();
        there?.close();
        daemon?.kill();
        await daemon?.exited;
        await rm(home, { recursive: true, force: true });
        await rm(SHARED, { recursive: true, force: true });
        await inContainer(['rm', '-rf', SHARED]).catch(() => undefined);
    });

    test('a node id on both machines is two shells, each with its own screen', async () => {
        const sessionId = `scope-${Date.now()}`;
        startedSessions.push(sessionId);
        for (const [client, cwd] of [
            [here, home],
            [there, REPO]
        ] as const) {
            await client.request('session.create', { sessionId, cwd, cols: 80, rows: 24 });
            await client.request('session.attach', { sessionId, cols: 80, rows: 24 });
        }
        await here.request('session.write', { sessionId, data: 'echo screen-of-here\n' });
        await there.request('session.write', { sessionId, data: 'echo screen-of-there\n' });
        await waitUntil('both shells to answer', async () => {
            here.takeOutput();
            there.takeOutput();
            const [mine, theirs] = await Promise.all([
                here.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 }),
                there.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 })
            ]);
            return mine.screen.includes('screen-of-here') && theirs.screen.includes('screen-of-there');
        });

        // The screen of one machine never carries a line that was typed on the other.
        const mine = await here.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
        const theirs = await there.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
        expect(mine.screen).not.toContain('screen-of-there');
        expect(theirs.screen).not.toContain('screen-of-here');
    }, 60_000);

    test('one absolute path is two checkouts, each with its own status', async () => {
        const [mine, theirs] = await Promise.all([
            here.request<GitStatus>('git.status', { cwd: SHARED }),
            there.request<GitStatus>('git.status', { cwd: SHARED })
        ]);
        expect(mine.branch).toBe('here');
        expect(theirs.branch).toBe('there');
        expect(mine.files.map((file) => file.path)).toEqual(['mine.txt']);
        expect(theirs.files.map((file) => file.path)).toEqual(['theirs.txt']);
    });

    test('unwatching that path on one machine leaves the watch on the other standing', async () => {
        await here.request('git.watch', { cwd: SHARED });
        await there.request('git.watch', { cwd: SHARED });
        await here.request('git.unwatch', { cwd: SHARED });
        here.takeEvents('git.status');
        there.takeEvents('git.status');

        await inContainer(['sh', '-c', `echo three >> ${SHARED}/theirs.txt`]);
        await waitUntil('the container to report its checkout changed', () => there.takeEvents('git.status').length > 0, 20_000);
        expect(here.takeEvents('git.status')).toEqual([]);
    }, 30_000);

    test('fs.list on one path answers about the machine it was asked of', async () => {
        const [mine, theirs] = await Promise.all([
            here.request<FsListResult>('fs.list', { path: SHARED }),
            there.request<FsListResult>('fs.list', { path: SHARED })
        ]);
        expect(mine.entries.map((entry) => entry.name)).toContain('mine.txt');
        expect(mine.entries.map((entry) => entry.name)).not.toContain('theirs.txt');
        expect(theirs.entries.map((entry) => entry.name)).toContain('theirs.txt');
        expect(theirs.entries.map((entry) => entry.name)).not.toContain('mine.txt');
    });

    test('context set on a node of the container is read back inside that container', async () => {
        const sessionId = `scope-context-${Date.now()}`;
        startedSessions.push(sessionId);
        await there.request('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        await there.request('session.attach', { sessionId, cols: 80, rows: 24 });
        await there.request('context.set', {
            targetId: sessionId,
            sources: [{ id: 'note-1', kind: 'text', title: 'Sprint goals', text: 'ship the pool' }]
        });

        there.takeOutput();
        /*
         * By its path in the image, not by its name: Debian's `/etc/profile` writes PATH from
         * scratch, so the directory the daemon puts in front of it is gone by the first prompt of a
         * login shell. The script itself is what this is about, and it reads the address and the
         * token out of the session's environment either way.
         */
        await there.request('session.write', {
            sessionId,
            data: '/app/apps/server/bin/ruimte-context && /app/apps/server/bin/ruimte-context read note-1\n'
        });
        let said = '';
        await waitUntil('the shell in the container to read its own context', () => {
            said += there.takeOutput();
            return said.includes('Sprint goals') && said.includes('ship the pool');
        });
    }, 30_000);

    /*
     * The two halves of the union. A project id is minted by the daemon that owns it, so one folder
     * on two machines is two projects, and neither daemon knows anything of the other's list. Last
     * of this block: opening a project writes into the folder the git tests above read.
     */
    test('one folder on both machines is two projects, and neither list holds the other', async () => {
        const [mine, theirs] = await Promise.all([
            here.request<ProjectOpenResult>('project.open', { folder: SHARED, name: 'Shared here' }),
            there.request<ProjectOpenResult>('project.open', { folder: SHARED, name: 'Shared there' })
        ]);
        expect(mine.summary.projectId).not.toBe(theirs.summary.projectId);
        expect(mine.summary.folder).toBe(SHARED);
        expect(theirs.summary.folder).toBe(SHARED);

        const [listedHere, listedThere] = await Promise.all([
            here.request<ProjectListResult>('project.list', {}),
            there.request<ProjectListResult>('project.list', {})
        ]);
        expect(listedHere.projects.map((project) => project.projectId)).toContain(mine.summary.projectId);
        expect(listedHere.projects.map((project) => project.projectId)).not.toContain(theirs.summary.projectId);
        expect(listedThere.projects.map((project) => project.projectId)).toContain(theirs.summary.projectId);
        expect(listedThere.projects.map((project) => project.projectId)).not.toContain(mine.summary.projectId);

        await here.request('project.delete', { projectId: mine.summary.projectId, removeFiles: true });
        await there.request('project.delete', { projectId: theirs.summary.projectId, removeFiles: true });
    }, 30_000);
});
