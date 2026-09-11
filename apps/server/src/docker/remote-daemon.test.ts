import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    parseServerFrame,
    type EndpointInfo,
    type PairResult,
    type FsBrowseResult,
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
    private readonly socket: WebSocket;
    private readonly pending = new Map<string, Pending>();
    private readonly output: string[] = [];
    private nextId = 1;

    private constructor(socket: WebSocket) {
        this.socket = socket;
        socket.onmessage = (message) => this.receive(String(message.data));
    }

    static async connect(token: string): Promise<RemoteClient> {
        const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
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

    private receive(raw: string): void {
        const parsed = parseServerFrame(JSON.parse(raw));
        if (!parsed.ok) {
            throw new Error(`The daemon sent a frame this client cannot read: ${parsed.message}`);
        }
        const frame = parsed.value;
        if (!('ok' in frame)) {
            if (frame.event === 'session.output') {
                this.output.push((frame.payload as { data: string }).data);
            }
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
    });
});
