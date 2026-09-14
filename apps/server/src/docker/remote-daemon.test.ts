import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { BrokerPeer, brokerHostOf, signalMessage, type BrokerRelayed, type SignalEnvelope } from '@ruimte/pulsar';
import { generateKeyPair, signMessage, verifySignature } from '../auth/keys.ts';
import { readLocalSecret } from '../auth/local-secret.ts';
import { DirectClient, type DirectCredential } from '../pulsar/direct-client.ts';
import {
    BYTES_CHUNK_MAX,
    clientAuthMessage,
    daemonChallengeMessage,
    parseServerFrame,
    type AuthChallengeResult,
    type AuthTicketResult,
    type BytesReadResult,
    type EndpointChangedEvent,
    type EndpointInfo,
    type PairResult,
    type FsBrowseResult,
    type FsListResult,
    type GitStatus,
    type ProjectListResult,
    type ProjectOpenResult,
    type ProjectSaveResult,
    type ProjectSummaryEvent,
    type ProjectView,
    type ServerHelloResult,
    type SessionAttachResult,
    type SessionInfo
} from '@ruimte/contracts';

/*
 * The daemon from `apps/server/docker`, talked to the way a client would: over the wire, from
 * another machine. It needs a container listening on a real port, so it only runs when someone
 * asks for it; `bun test` on this repository (and in CI) stays a run of unit tests.
 *
 *   bun run --cwd apps/server docker:test
 *
 * That script starts `daemon-test`, a container of its own on 4320 that throws its state away on
 * every start. The container on 4310 is the one to work against and keeps everything it is given,
 * which these tests, counting projects and repositories, could not run against.
 */
const ENABLED = process.env.RUIMTE_DOCKER === '1';

// The test container by default, so a run by hand never reaches the one being worked against.
const CONTAINER = process.env.RUIMTE_DOCKER_CONTAINER ?? 'ruimte-remote-test';
// The compose file maps this port straight through, so it names the daemon on both sides.
const PORT = Number(process.env.RUIMTE_DOCKER_PORT ?? 4320);
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
    private readonly listeners = new Map<string, (payload: unknown) => void>();
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

    /* Hears one event as it arrives, for a test that has to answer it straight away rather than read it later. */
    listen(event: string, handler: (payload: unknown) => void): void {
        this.listeners.set(event, handler);
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
            const listener = this.listeners.get(frame.event);
            if (listener) {
                listener(frame.payload);
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
const pair = async (publicKey?: string): Promise<PairResult> => {
    const printed = await inContainer(['bun', '/app/apps/server/src/main.ts', 'pair', '--port', String(PORT)]);
    const token = printed.split('\n').at(-1)?.split('#').at(-1) ?? '';
    if (!token) {
        throw new Error(`No pairing token in what \`ruimte pair\` printed: ${printed}`);
    }
    const response = await fetch(`${BASE_URL}/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, label: 'docker test', ...(publicKey ? { publicKey } : {}) })
    });
    if (!response.ok) {
        throw new Error(`Pairing failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as PairResult;
};

/* The client half of the handshake: take the daemon's nonce, check who signed it, sign it back. */
const signIn = async (key: { publicKey: string; privateKey: string }, daemonId: string): Promise<Response> => {
    const challenge = (await (await fetch(`${BASE_URL}/auth/challenge`, { method: 'POST' })).json()) as AuthChallengeResult;
    if (!verifySignature(challenge.daemon.publicKey, daemonChallengeMessage(challenge.daemon.id, challenge.challenge), challenge.daemon.signature)) {
        throw new Error('The daemon did not sign its own challenge');
    }
    return fetch(`${BASE_URL}/auth/ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            publicKey: key.publicKey,
            challenge: challenge.challenge,
            signature: signMessage(key.privateKey, clientAuthMessage(daemonId, challenge.challenge, key.publicKey))
        })
    });
};

const ticketFor = async (key: { publicKey: string; privateKey: string }, daemonId: string): Promise<string> => {
    const response = await signIn(key, daemonId);
    if (!response.ok) {
        throw new Error(`Signing in failed: ${response.status} ${await response.text()}`);
    }
    return ((await response.json()) as AuthTicketResult).ticket;
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
        await waitUntil(`a daemon on ${BASE_URL}; start one with \`bun run --cwd apps/server docker:test\``, answers, 5_000);
        paired = await pair();
        sessionToken = paired.sessionToken!;
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

    test('a daemon in a container has no hardware to name', async () => {
        const hello = await client.request<ServerHelloResult>('server.hello', {});
        /*
         * A container carries neither the DMI tree nor a device tree, so there is nothing here that
         * says what the machine is and the field stays out of the answer; the row for such a daemon
         * keeps the plain "This machine". A Linux daemon on real hardware answers with what its
         * firmware wrote ("XPS 15 9500", "Raspberry Pi 4 Model B"), which is why it is optional.
         */
        expect(hello.model).toBeUndefined();
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
        const written = JSON.parse(await inContainer(['cat', `${HOME}/endpoint.json`])) as { version: number; id: string; publicKey: string };
        expect(written.version).toBe(1);
        expect(written.id).toBe(info.id);
        expect(written.publicKey).toBe(info.publicKey!);
        /*
         * What a second start would do, run against the home of the daemon that is up. A real
         * `docker restart` throws that home away (`docker/entrypoint.sh`, `RUIMTE_FRESH_STATE`), so
         * it would test the harness instead of the daemon.
         */
        const restarted = await inContainer([
            'bun',
            '-e',
            `import { readOrCreateEndpointIdentity } from '/app/apps/server/src/endpoint-id.ts'; console.log((await readOrCreateEndpointIdentity('${HOME}')).id);`
        ]);
        expect(restarted).toBe(info.id);
    });

    test('a client on another machine cannot mint a pairing link', async () => {
        await expect(client.request('auth.pairingToken', {})).rejects.toThrow(/forbidden/);
    });

    /*
     * Inside the container every request comes from loopback, which is what a tunnel or a reverse
     * proxy in front of a daemon looks like. Without the local secret none of it opens: `pair()`
     * above is the same request with the secret, read from the home the way `ruimte pair` reads it.
     */
    test('loopback without the local secret gets through no door', async () => {
        const doors = [
            ['/ws', 'GET'],
            ['/auth/pairing-token', 'POST'],
            [`/fs/file?path=${REPO}/README.md`, 'GET'],
            ['/projects/nope/icon', 'GET'],
            ['/attachments/node-1/deadbeef', 'GET']
        ];
        const script = `const codes = []; for (const [path, method] of ${JSON.stringify(doors)}) { codes.push((await fetch('http://127.0.0.1:${PORT}' + path, { method })).status); } console.log(codes.join(','));`;
        expect(await inContainer(['bun', '-e', script])).toBe('401,403,401,401,401');
        // A wrong secret is no secret either.
        const guessed = `console.log((await fetch('http://127.0.0.1:${PORT}/auth/pairing-token', { method: 'POST', headers: { authorization: 'Bearer guessed' } })).status);`;
        expect(await inContainer(['bun', '-e', guessed])).toBe('403');
    });

    test('a freshly paired daemon lists nothing at all, and asking twice still makes nothing', async () => {
        expect((await client.request<ProjectListResult>('project.list', {})).projects).toEqual([]);
        expect((await client.request<ProjectListResult>('project.list', {})).projects).toEqual([]);
    });

    test('a project opens on a repository in /work', async () => {
        const opened = await client.request<ProjectOpenResult>('project.open', { folder: REPO, name: 'Atlas' });
        openedProjects.push(opened.summary.projectId);
        expect(opened.summary.folder).toBe(REPO);
        expect(opened.document.views.length).toBeGreaterThan(0);

        const listed = await client.request<ProjectListResult>('project.list', {});
        expect(listed.projects.some((project) => project.projectId === opened.summary.projectId)).toBe(true);
    });

    test('naming the machine reaches every client and outlives the label it was started with', async () => {
        const other = await RemoteClient.connect(sessionToken);
        try {
            const named = await client.request<EndpointInfo>('endpoint.setIdentity', { name: 'The box downstairs', icon: { kind: 'lucide', value: 'server' } });
            expect(named.label).toBe('The box downstairs');
            expect(named.nameSource).toBe('chosen');
            expect(named.icon).toEqual({ kind: 'lucide', value: 'server' });

            // The client that did not ask is told, so two machines never disagree about a name.
            let heard: EndpointChangedEvent[] = [];
            await waitUntil('the other client to hear the new name', () => {
                heard = heard.concat(other.takeEvents<EndpointChangedEvent>('endpoint.changed'));
                return heard.length > 0;
            });
            expect(heard.at(-1)).toMatchObject({ id: named.id, label: 'The box downstairs', nameSource: 'chosen' });

            // It is the machine's, not the connection's: it sits in the home next to the id.
            const written = JSON.parse(await inContainer(['cat', `${HOME}/endpoint.json`])) as { version: number; name: string };
            expect(written.version).toBe(1);
            expect(written.name).toBe('The box downstairs');
        } finally {
            // Back to `RUIMTE_LABEL`, which is what the rest of the suite expects this machine to answer.
            await client.request('endpoint.setIdentity', { name: null, icon: null });
            other.close();
        }
        const back = await client.request<EndpointInfo>('endpoint.info', {});
        expect(back.label).toBe('docker-linux');
        expect(back.nameSource).toBe('default');
    });

    test('closing a project drops it under Recent on the machine, and opening it brings it back', async () => {
        const other = await RemoteClient.connect(sessionToken);
        try {
            const opened = await client.request<ProjectOpenResult>('project.open', { folder: '/work/beacon', name: 'Beacon' });
            const { projectId } = opened.summary;
            openedProjects.push(projectId);
            expect(opened.summary.closedAt).toBeNull();
            other.takeEvents('project.summary');

            await client.request('project.close', { projectId });
            const closed = (await other.request<ProjectListResult>('project.list', {})).projects.find((project) => project.projectId === projectId);
            expect(closed?.closedAt).toBeNumber();

            // The other client is told, so a machine's list reads the same from both sides.
            let heard: ProjectSummaryEvent[] = [];
            await waitUntil('the other client to hear the project close', () => {
                heard = heard.concat(other.takeEvents<ProjectSummaryEvent>('project.summary'));
                return heard.some((event) => event.summary.projectId === projectId);
            });

            const again = await other.request<ProjectOpenResult>('project.open', { projectId });
            expect(again.summary.closedAt).toBeNull();
            expect((await client.request<ProjectListResult>('project.list', {})).projects.find((row) => row.projectId === projectId)?.closedAt).toBeNull();
        } finally {
            other.close();
        }
    });

    test('the sessions of a project outlive its close, so the client is the one that ends them', async () => {
        const opened = await client.request<ProjectOpenResult>('project.open', { folder: '/work/beacon', name: 'Beacon' });
        const { projectId } = opened.summary;
        openedProjects.push(projectId);
        const sessionId = `node-${Date.now()}`;
        startedSessions.push(sessionId);
        await client.request<SessionInfo>('session.create', { sessionId, cwd: '/work/beacon', cols: 80, rows: 24 });

        /* A session is keyed on a node id and nothing on the machine ties it to a project, which is
           why closing one stops its sessions from the client, one `session.kill` at a time. */
        await client.request('project.close', { projectId });
        const kept = await client.request<{ sessions: SessionInfo[] }>('session.list', {});
        expect(kept.sessions.some((session) => session.sessionId === sessionId)).toBe(true);

        await client.request('session.kill', { sessionId });
        const gone = await client.request<{ sessions: SessionInfo[] }>('session.list', {});
        expect(gone.sessions.some((session) => session.sessionId === sessionId)).toBe(false);
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

describe.skipIf(!ENABLED)('signing in instead of carrying a token', () => {
    let daemonId: string;
    let daemonKey: string;

    beforeAll(async () => {
        const answers = async (): Promise<boolean> => (await fetch(`${BASE_URL}/health`).catch(() => null))?.ok === true;
        await waitUntil(`a daemon on ${BASE_URL}; start one with \`bun run --cwd apps/server docker:test\``, answers, 5_000);
        const info = (await (await fetch(`${BASE_URL}/auth/challenge`, { method: 'POST' })).json()) as AuthChallengeResult;
        daemonId = info.daemon.id;
        daemonKey = info.daemon.publicKey;
    });

    test('pairing with a public key hands out nothing to carry around', async () => {
        const key = generateKeyPair();
        const result = await pair(key.publicKey);
        expect(result.sessionToken).toBeUndefined();
        expect(result.endpoint.publicKey).toBe(daemonKey);
        expect(result.endpoint.id).toBe(daemonId);

        const client = await RemoteClient.connect(await ticketFor(key, daemonId));
        const info = await client.request<EndpointInfo>('endpoint.info', {});
        expect(info.authenticated).toBe(true);
        expect(info.publicKey).toBe(daemonKey);
        client.close();
    });

    test('every connection carries a credential of its own', async () => {
        const key = generateKeyPair();
        await pair(key.publicKey);
        const first = await ticketFor(key, daemonId);
        const second = await ticketFor(key, daemonId);
        expect(first).not.toBe(second);

        const client = await RemoteClient.connect(second);
        expect((await client.request<EndpointInfo>('endpoint.info', {})).authenticated).toBe(true);
        client.close();
    });

    test('the daemon proves which machine it is, and its key is not the one next door', async () => {
        const challenge = (await (await fetch(`${BASE_URL}/auth/challenge`, { method: 'POST' })).json()) as AuthChallengeResult;
        expect(verifySignature(daemonKey, daemonChallengeMessage(daemonId, challenge.challenge), challenge.daemon.signature)).toBe(true);
        // What a client sees when something else answers on the address it remembered.
        expect(verifySignature(generateKeyPair().publicKey, daemonChallengeMessage(daemonId, challenge.challenge), challenge.daemon.signature)).toBe(false);
    });

    test('a wrong signature, a replayed challenge and a key nobody paired all get 401', async () => {
        const key = generateKeyPair();
        await pair(key.publicKey);

        const challenge = (await (await fetch(`${BASE_URL}/auth/challenge`, { method: 'POST' })).json()) as AuthChallengeResult;
        const signature = signMessage(key.privateKey, clientAuthMessage(daemonId, challenge.challenge, key.publicKey));
        const redeem = (body: unknown) =>
            fetch(`${BASE_URL}/auth/ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

        expect((await redeem({ publicKey: key.publicKey, challenge: challenge.challenge, signature: 'nope' })).status).toBe(401);
        // That attempt used the nonce up, so the signature that was right for it is too late now.
        expect((await redeem({ publicKey: key.publicKey, challenge: challenge.challenge, signature })).status).toBe(401);

        const response = await signIn(generateKeyPair(), daemonId);
        expect(response.status).toBe(401);
    });

    test('a signature meant for another machine is refused here', async () => {
        const key = generateKeyPair();
        await pair(key.publicKey);
        expect((await signIn(key, 'a-daemon-somewhere-else')).status).toBe(401);
    });

    test('revoking a signed-in client kills its ticket in the same breath', async () => {
        const key = generateKeyPair();
        await pair(key.publicKey);
        const ticket = await ticketFor(key, daemonId);
        const signed = await RemoteClient.connect(ticket);
        const mine = (await signed.request<{ sessions: { id: string; current: boolean }[] }>('auth.sessions', {})).sessions.find((session) => session.current)!;

        // From another client, because revoking a session closes its own sockets before it could hear the answer.
        const other = await RemoteClient.connect((await pair()).sessionToken!);
        await other.request('auth.revoke', { id: mine.id });
        await waitUntil('the socket of a revoked client to close', () => signed.closed);

        expect((await fetch(`${BASE_URL}/ws?token=${ticket}`)).status).toBe(401);
        // Signing again is no way back in either: the key went with the session.
        expect((await signIn(key, daemonId)).status).toBe(401);
        other.close();
    });

    test('a client paired on a token moves onto a key over its own connection', async () => {
        const token = (await pair()).sessionToken!;
        const client = await RemoteClient.connect(token);
        const key = generateKeyPair();

        expect(await client.request<{ registered: boolean }>('auth.registerKey', { publicKey: key.publicKey })).toEqual({ registered: true });
        // The token still works until the key has proved itself, so nothing is locked out mid-upgrade.
        const stillFine = await RemoteClient.connect(token);
        stillFine.close();

        const ticket = await ticketFor(key, daemonId);
        expect((await fetch(`${BASE_URL}/ws?token=${token}`)).status).toBe(401);
        const signed = await RemoteClient.connect(ticket);
        expect((await signed.request<EndpointInfo>('endpoint.info', {})).authenticated).toBe(true);
        signed.close();
        client.close();
    });
});

/*
 * The wire over a WebRTC DataChannel instead of the socket. The signals ride over a socket to the
 * container because there is no broker yet, and that socket is closed the moment the channel is up:
 * everything after it, the terminal included, travels over UDP through the ports the compose file
 * publishes, on the access the channel's own handshake gave it.
 */
describe.skipIf(!ENABLED)('a direct connection to the daemon in the container', () => {
    const clients: DirectClient[] = [];
    const sockets: RemoteClient[] = [];

    afterAll(() => {
        for (const client of clients) {
            client.close();
        }
        for (const socket of sockets) {
            socket.close();
        }
    });

    /* A channel signaled over a socket that holds a credential of its own, whatever the channel then presents. */
    const openDirect = async (credential: DirectCredential, socketToken: string, ping?: { idleMs?: number; timeoutMs?: number }): Promise<DirectClient> => {
        const socket = await RemoteClient.connect(socketToken);
        sockets.push(socket);
        const client = new DirectClient({
            stunServers: [],
            credential,
            timeoutMs: 20_000,
            ...(ping ? { ping } : {}),
            signal: (envelope) => void socket.request('direct.signal', { envelope })
        });
        clients.push(client);
        socket.listen('direct.signaled', (payload) => client.receiveSignal((payload as { envelope: Parameters<DirectClient['receiveSignal']>[0] }).envelope));
        try {
            await client.open();
        } finally {
            socket.close();
        }
        return client;
    };

    test('a paired key opens the channel from outside the container and a terminal answers over it', async () => {
        const key = generateKeyPair();
        const paired = await pair(key.publicKey);
        const client = await openDirect(
            { kind: 'key', publicKey: key.publicKey, privateKey: key.privateKey, daemonId: paired.endpoint.id, daemonPublicKey: paired.endpoint.publicKey! },
            await ticketFor(key, paired.endpoint.id)
        );
        expect((await client.request<EndpointInfo>('endpoint.info', {})).authenticated).toBe(true);

        let output = '';
        client.onFrame((raw) => {
            const frame = JSON.parse(raw) as { event?: string; payload?: { data?: string } };
            if (frame.event === 'session.output') {
                output += frame.payload?.data ?? '';
            }
        });
        const sessionId = `docker-direct-${Date.now()}`;
        await client.request<SessionInfo>('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        try {
            await client.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
            await client.request('session.write', { sessionId, data: 'echo direct-$((6*7)) && uname -s\n' });
            await waitUntil('the shell to answer over the channel', () => output.includes('direct-42') && output.includes('Linux'));
        } finally {
            await client.request('session.kill', { sessionId }).catch(() => undefined);
        }
        console.log(`direct channel to the container: open after ${client.timings.channelOpenMs} ms, signed in after ${client.timings.authenticatedMs} ms`);
    }, 60_000);

    /* A client on a paired key, the way the app holds one. */
    const pairedDirect = async (ping?: { idleMs?: number; timeoutMs?: number }): Promise<DirectClient> => {
        const key = generateKeyPair();
        const paired = await pair(key.publicKey);
        return openDirect(
            { kind: 'key', publicKey: key.publicKey, privateKey: key.privateKey, daemonId: paired.endpoint.id, daemonPublicKey: paired.endpoint.publicKey! },
            await ticketFor(key, paired.endpoint.id),
            ping
        );
    };

    test('the bytes of a file come over the channel in pieces, and what the route would refuse is refused', async () => {
        const client = await pairedDirect();
        const path = `${REPO}/direct-bytes.gif`;
        const huge = `${REPO}/direct-huge.gif`;
        // A GIF header is all the daemon sniffs; the noise behind it makes three pieces.
        await inContainer(['sh', '-c', `{ printf 'GIF89a'; head -c ${BYTES_CHUNK_MAX * 2 + 4096} /dev/urandom; } > ${path}`]);
        await inContainer(['sh', '-c', `printf 'GIF89a' > ${huge} && truncate -s 40M ${huge}`]);
        try {
            const expected = Buffer.from(await inContainer(['base64', '-w0', path]), 'base64');
            const parts: Buffer[] = [];
            let offset = 0;
            let size = Number.POSITIVE_INFINITY;
            const started = Date.now();
            while (offset < size) {
                const piece = await client.request<BytesReadResult>('bytes.read', { resource: { kind: 'file', path }, offset, length: BYTES_CHUNK_MAX });
                expect(piece.mime).toBe('image/gif');
                size = piece.size;
                const bytes = Buffer.from(piece.data, 'base64');
                parts.push(bytes);
                offset += bytes.length;
            }
            expect(parts).toHaveLength(3);
            expect(Buffer.concat(parts).equals(expected)).toBe(true);
            console.log(`bytes over the direct channel: ${size} bytes in ${parts.length} pieces, ${Date.now() - started} ms`);

            const refused = (resource: unknown) => client.request('bytes.read', { resource, offset: 0, length: 1024 });
            await expect(refused({ kind: 'file', path: '/etc/passwd' })).rejects.toThrow(/^not-found:/);
            await expect(refused({ kind: 'file', path: `${HOME}/endpoint.json` })).rejects.toThrow(/^not-found:/);
            await expect(refused({ kind: 'attachment', chatId: 'no-such-chat', attachmentId: 'nothing' })).rejects.toThrow(/^not-found:/);
            await expect(refused({ kind: 'file', path: huge })).rejects.toThrow(/^too-large: This file is 40 MB/);
        } finally {
            await inContainer(['rm', '-f', path, huge]);
        }
    }, 60_000);

    test('a machine that stops answering is noticed by the ping long before ICE gives up', async () => {
        const client = await pairedDirect({ idleMs: 2_000, timeoutMs: 5_000 });
        let lostAt: number | null = null;
        client.onLost(() => {
            lostAt = Date.now();
        });
        // Frozen rather than stopped: no process on the other end gets to say goodbye, like a machine that lost its network.
        await docker(['pause', CONTAINER]);
        const pausedAt = Date.now();
        let iceAtLoss = '';
        try {
            await waitUntil(
                'the ping to notice',
                () => {
                    if (lostAt === null) {
                        iceAtLoss = client.iceState;
                    }
                    return lostAt !== null;
                },
                20_000
            );
        } finally {
            await docker(['unpause', CONTAINER]);
        }
        const noticed = lostAt! - pausedAt;
        console.log(`ping noticed a paused machine after ${noticed} ms; ICE still said ${iceAtLoss} at that moment`);
        expect(noticed).toBeLessThan(9_000);
    }, 60_000);

    test('a key nobody paired and a channel without a proof get nothing, whatever the signaling socket holds', async () => {
        const paired = await pair(generateKeyPair().publicKey);
        const socketKey = generateKeyPair();
        await pair(socketKey.publicKey);
        const ticket = await ticketFor(socketKey, paired.endpoint.id);
        const stranger = generateKeyPair();
        await expect(
            openDirect(
                {
                    kind: 'key',
                    publicKey: stranger.publicKey,
                    privateKey: stranger.privateKey,
                    daemonId: paired.endpoint.id,
                    daemonPublicKey: paired.endpoint.publicKey!
                },
                ticket
            )
        ).rejects.toThrow(/does not recognize/);
        await expect(openDirect({ kind: 'none' }, await ticketFor(socketKey, paired.endpoint.id))).rejects.toThrow(/^Expected a proof$/);
    }, 60_000);
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
        // Being on this machine is not enough for the daemon here either: the secret of its home is what gets in.
        await expect(RemoteClient.connect(null, LOCAL_PORT)).rejects.toThrow();
        here = await RemoteClient.connect(await readLocalSecret(home), LOCAL_PORT);
        there = await RemoteClient.connect((await pair()).sessionToken!);
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

        const back = await RemoteClient.connect((await pair()).sessionToken!);
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
        here = await RemoteClient.connect(await readLocalSecret(home), LOCAL_PORT);
        there = await RemoteClient.connect((await pair()).sessionToken!);
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

    test('a note linked on a canvas of the container is read back inside that container', async () => {
        const sessionId = `scope-context-${Date.now()}`;
        startedSessions.push(sessionId);
        /* A folder of its own, so the project file it writes stays out of the checkouts the git tests read. */
        const opened = await there.request<ProjectOpenResult>('project.open', { folder: `/tmp/ruimte-context-${Date.now()}`, createFolder: true });
        // The daemon derives the links from the document it saved, so no client has to tell it.
        await there.request<ProjectSaveResult>('project.save', {
            projectId: opened.summary.projectId,
            baseRev: opened.document.rev,
            content: {
                name: 'Context',
                color: '#000',
                views: [
                    {
                        kind: 'canvas',
                        id: 'main',
                        name: 'Canvas',
                        nodes: [
                            { id: sessionId, kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                            { id: 'note-1', kind: 'note', title: 'Sprint goals', x: 600, y: 0, w: 240, h: 200, body: 'ship the pool' }
                        ],
                        texts: [],
                        edges: [{ id: 'edge-1', from: 'note-1', to: sessionId }],
                        layouts: []
                    }
                ] satisfies ProjectView[]
            }
        });
        await there.request('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        await there.request('session.attach', { sessionId, cols: 80, rows: 24 });

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

/*
 * Two projects open at once, one per machine, which is what a workspace carrying its own connection
 * is for. Every request here is made twice, once per daemon, and neither answer may know about the
 * other: the canvas each saves, the bytes each serves and the shell each runs stay on their own side.
 */
describe.skipIf(!ENABLED)('two projects side by side', () => {
    const LOCAL_PORT = Number(process.env.RUIMTE_SIDE_PORT ?? 4313);
    const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
    let daemon: ReturnType<typeof Bun.spawn> | null = null;
    let home = '';
    let folder = '';
    let here: RemoteClient;
    let there: RemoteClient;
    let sessionToken = '';
    let mine = '';
    let theirs = '';
    /* The rev each file is at; a save names the one it was based on and the daemon refuses any other. */
    let mineRev = 0;
    let theirsRev = 0;

    const canvas = (name: string): ProjectView[] => [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Main',
            nodes: [],
            texts: [{ id: 'text-1', x: 0, y: 0, text: name, size: 18 }],
            edges: [],
            layouts: []
        }
    ];

    beforeAll(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-side-'));
        folder = await mkdtemp(join(tmpdir(), 'ruimte-side-project-'));
        daemon = Bun.spawn(
            ['bun', join(import.meta.dir, '../main.ts'), '--host', '127.0.0.1', '--port', String(LOCAL_PORT), '--no-hooks', '--no-price-fetch'],
            { env: { ...process.env, RUIMTE_HOME: home }, stdout: 'ignore', stderr: 'inherit' }
        );
        await waitUntil(`a second daemon on ${LOCAL_URL}`, () => answers(LOCAL_URL));
        await waitUntil(`the container on ${BASE_URL}`, () => answers(BASE_URL), 5_000);
        here = await RemoteClient.connect(await readLocalSecret(home), LOCAL_PORT);
        sessionToken = (await pair()).sessionToken!;
        there = await RemoteClient.connect(sessionToken);

        const [opened, openedThere] = await Promise.all([
            here.request<ProjectOpenResult>('project.open', { folder, name: 'Here' }),
            there.request<ProjectOpenResult>('project.open', { folder: REPO, name: 'There' })
        ]);
        mine = opened.summary.projectId;
        theirs = openedThere.summary.projectId;
        mineRev = opened.document.rev;
        theirsRev = openedThere.document.rev;
    }, 60_000);

    afterAll(async () => {
        await here?.request('project.delete', { projectId: mine, removeFiles: true }).catch(() => undefined);
        // The last test stops the container, so it is put back here rather than there: a failure must not leave it down.
        await docker(['start', CONTAINER]).catch(() => undefined);
        await waitUntil(`the container on ${BASE_URL} again`, () => answers(BASE_URL), 60_000).catch(() => undefined);
        // Its socket went with the stop, so what it opened is cleared from inside it.
        await inContainer(['rm', '-rf', `${REPO}/.ruimte`]).catch(() => undefined);
        here?.close();
        there?.close();
        daemon?.kill();
        await daemon?.exited;
        await rm(home, { recursive: true, force: true });
        await rm(folder, { recursive: true, force: true });
    });

    test('each workspace saves its own canvas into its own project file', async () => {
        const [mineSaved, theirsSaved] = await Promise.all([
            here.request<ProjectSaveResult>('project.save', {
                projectId: mine,
                baseRev: mineRev,
                content: { name: 'Here', color: '#000', views: canvas('written here') }
            }),
            there.request<ProjectSaveResult>('project.save', {
                projectId: theirs,
                baseRev: theirsRev,
                content: { name: 'There', color: '#000', views: canvas('written there') }
            })
        ]);
        expect(mineSaved.rev).toBe(mineRev + 1);
        expect(theirsSaved.rev).toBe(theirsRev + 1);
        mineRev = mineSaved.rev;
        theirsRev = theirsSaved.rev;

        const onDisk = await Bun.file(join(folder, '.ruimte/project.json')).text();
        expect(onDisk).toContain('written here');
        expect(onDisk).not.toContain('written there');
        const overThere = await inContainer(['cat', `${REPO}/.ruimte/project.json`]);
        expect(overThere).toContain('written there');
        expect(overThere).not.toContain('written here');
    }, 30_000);

    test('a project opened on one machine is not in the other machine list', async () => {
        const [listedHere, listedThere] = await Promise.all([
            here.request<ProjectListResult>('project.list', {}),
            there.request<ProjectListResult>('project.list', {})
        ]);
        expect(listedHere.projects.map((project) => project.projectId)).toEqual([mine]);
        expect(listedThere.projects.map((project) => project.projectId)).toContain(theirs);
        expect(listedThere.projects.map((project) => project.projectId)).not.toContain(mine);
    });

    test('each files panel browses its own file system, at the same time', async () => {
        const [mineList, theirsList] = await Promise.all([
            here.request<FsListResult>('fs.list', { path: folder, hidden: true }),
            there.request<FsListResult>('fs.list', { path: REPO })
        ]);
        expect(mineList.entries.map((entry) => entry.name)).toContain('.ruimte');
        expect(theirsList.entries.map((entry) => entry.name)).toContain('README.md');
        expect(theirsList.entries.map((entry) => entry.name)).not.toContain(basename(folder));
    });

    test('each git panel reads the checkout of its own machine', async () => {
        const [mineStatus, theirsStatus] = await Promise.all([
            here.request<GitStatus>('git.status', { cwd: folder }),
            there.request<GitStatus>('git.status', { cwd: REPO })
        ]);
        // A folder that is no checkout has no branch; the container's repository has one and its outstanding work.
        expect(mineStatus.branch).toBeNull();
        expect(mineStatus.files).toEqual([]);
        expect(theirsStatus.branch).toBe('main');
        expect(theirsStatus.files.map((file) => file.path)).toContain('README.md');
    });

    /*
     * The bytes of an image never travel over the socket, so the viewer of each workspace builds a
     * URL against its own daemon with its own token. The token of one machine opens nothing on the
     * other, which is the half that has to hold.
     */
    test('the bytes a viewer draws come from the daemon of its own workspace', async () => {
        /* A one pixel GIF, because the route serves images and video and nothing else. The two
           differ in one byte of the palette, which is what tells the answers apart. */
        const here_gif = 'R0lGODlhAQABAIABAP8AAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        const there_gif = 'R0lGODlhAQABAIABAAD/AAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        await Bun.write(join(folder, 'here.gif'), Buffer.from(here_gif, 'base64'));
        await inContainer(['sh', '-c', `echo ${there_gif} | base64 -d > ${REPO}/there.gif`]);

        const localSecret = encodeURIComponent((await readLocalSecret(home)) ?? '');
        const mineBytes = await fetch(`${LOCAL_URL}/fs/file?path=${encodeURIComponent(join(folder, 'here.gif'))}&v=1-1&token=${localSecret}`);
        expect(Buffer.from(await mineBytes.arrayBuffer()).toString('base64')).toBe(here_gif);
        const theirsBytes = await fetch(`${BASE_URL}/fs/file?path=${encodeURIComponent(`${REPO}/there.gif`)}&v=1-1&token=${encodeURIComponent(sessionToken)}`);
        expect(Buffer.from(await theirsBytes.arrayBuffer()).toString('base64')).toBe(there_gif);

        // The same URL without this machine's token: a workspace only reaches the daemon it paired with.
        const withoutToken = await fetch(`${BASE_URL}/fs/file?path=${encodeURIComponent(`${REPO}/there.gif`)}&v=1-1`);
        expect(withoutToken.status).toBe(401);
    }, 30_000);

    /* Last of this block: the container goes down and only comes back for the tests after it. */
    test('the container going down leaves the other workspace saving', async () => {
        await docker(['stop', '--time', '5', CONTAINER]);
        await waitUntil('the socket to the container to notice', () => there.closed);

        expect(here.closed).toBe(false);
        const saved = await here.request<ProjectSaveResult>('project.save', {
            projectId: mine,
            baseRev: mineRev,
            content: { name: 'Here', color: '#000', views: canvas('saved while the other machine is gone') }
        });
        expect(saved.rev).toBe(mineRev + 1);
        mineRev = saved.rev;
        expect(await Bun.file(join(folder, '.ruimte/project.json')).text()).toContain('saved while the other machine is gone');
    }, 120_000);
});

/*
 * The same channel with no socket to the container at all. A broker runs on this machine, the
 * container dials it at `host.docker.internal` (`compose.yml`), and a client here signals through it
 * alone: port 4320 is used for pairing and nothing after it. Stopping the broker afterwards shows
 * that a channel that is in never needed it again.
 */
describe.skipIf(!ENABLED)('a direct connection signaled through the broker', () => {
    const BROKER_PORT = 4420;
    const BROKER_URL = `ws://127.0.0.1:${BROKER_PORT}`;
    const BROKER_HEALTH = `http://127.0.0.1:${BROKER_PORT}/health`;
    let broker: Subprocess | null = null;
    const clients: DirectClient[] = [];
    const sockets: WebSocket[] = [];

    beforeAll(async () => {
        broker = Bun.spawn(['bun', join(import.meta.dir, '..', '..', '..', 'pulsar-broker', 'src', 'main.ts'), '--port', String(BROKER_PORT)], {
            stdout: 'ignore',
            stderr: 'inherit'
        });
        await waitUntil('the broker to answer', async () => (await fetch(BROKER_HEALTH).catch(() => null))?.ok === true);
    });

    afterAll(async () => {
        for (const client of clients) {
            client.close();
        }
        for (const socket of sockets) {
            socket.close();
        }
        broker?.kill();
        await broker?.exited;
    });

    /* The container retries the broker with a backoff of up to 30 seconds, and it was started before the broker was. */
    const machineAnnounced = (): Promise<void> =>
        waitUntil(
            'the machine in the container to announce itself to the broker',
            async () => (((await (await fetch(BROKER_HEALTH)).json()) as { machines: number }).machines ?? 0) >= 1,
            45_000
        );

    /* A client on the broker, the way the app signs in: its own key, the host it dialed, every relay signed. */
    const onBroker = async (key: { publicKey: string; privateKey: string }) => {
        const socket = new WebSocket(BROKER_URL);
        sockets.push(socket);
        const relayed: BrokerRelayed[] = [];
        const listeners = new Set<(frame: BrokerRelayed) => void>();
        let ready = false;
        const peer = new BrokerPeer({
            role: 'client',
            publicKey: key.publicKey,
            host: brokerHostOf(BROKER_URL),
            sign: (message) => signMessage(key.privateKey, message),
            send: (frame) => socket.send(frame),
            events: {
                ready: () => {
                    ready = true;
                },
                relayed: (frame) => {
                    relayed.push(frame);
                    for (const listener of listeners) {
                        listener(frame);
                    }
                },
                refused: (frame) => {
                    throw new Error(`The broker refused: ${JSON.stringify(frame)}`);
                },
                failed: (reason) => {
                    throw new Error(reason);
                }
            }
        });
        socket.onopen = () => peer.start();
        socket.onmessage = (message) => void peer.receive(String(message.data));
        await waitUntil('the client to sign in to the broker', () => ready);
        return { socket, peer, relayed, listen: (listener: (frame: BrokerRelayed) => void) => listeners.add(listener) };
    };

    test('the pairing answer names the broker the machine announces itself to', async () => {
        const paired = await pair(generateKeyPair().publicKey);
        expect(paired.endpoint.brokerUrl).toBe(BROKER_URL);
        await machineAnnounced();
    }, 60_000);

    test('a key nobody paired gets a signed not-paired, and a signal a paired key did not sign gets nothing', async () => {
        await machineAnnounced();
        const machineKey = (await pair(generateKeyPair().publicKey)).endpoint.publicKey!;
        const offer: SignalEnvelope = { connectionId: `stranger-${Date.now()}`, signal: { kind: 'offer', sdp: 'v=0' } };

        const stranger = generateKeyPair();
        const strangerOnBroker = await onBroker(stranger);
        await strangerOnBroker.peer.relay(machineKey, offer);
        await waitUntil('the refusal', () => strangerOnBroker.relayed.length === 1);
        const refusal = strangerOnBroker.relayed[0]!;
        expect(refusal.from).toBe(machineKey);
        expect(refusal.envelope).toEqual({ connectionId: offer.connectionId, signal: { kind: 'close', reason: 'not-paired' } });
        expect(verifySignature(machineKey, signalMessage(machineKey, stranger.publicKey, refusal.envelope), refusal.signature)).toBe(true);

        const pairedKey = generateKeyPair();
        await pair(pairedKey.publicKey);
        const pairedOnBroker = await onBroker(pairedKey);
        const forged: SignalEnvelope = { connectionId: `forged-${Date.now()}`, signal: { kind: 'offer', sdp: 'v=0' } };
        pairedOnBroker.socket.send(
            JSON.stringify({
                type: 'relay',
                id: 'forged',
                to: machineKey,
                envelope: forged,
                signature: signMessage(generateKeyPair().privateKey, signalMessage(pairedKey.publicKey, machineKey, forged))
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(pairedOnBroker.relayed).toEqual([]);
    }, 60_000);

    test('a paired key opens the channel through the broker alone, and the channel outlives the broker', async () => {
        await machineAnnounced();
        const key = generateKeyPair();
        const paired = await pair(key.publicKey);
        const machineKey = paired.endpoint.publicKey!;
        const onTheBroker = await onBroker(key);
        const client = new DirectClient({
            stunServers: [],
            credential: { kind: 'key', publicKey: key.publicKey, privateKey: key.privateKey, daemonId: paired.endpoint.id, daemonPublicKey: machineKey },
            timeoutMs: 20_000,
            signal: (envelope) => void onTheBroker.peer.relay(machineKey, envelope)
        });
        clients.push(client);
        onTheBroker.listen((frame) => {
            // Believed only from the pinned key and only with its signature, the way the app does it.
            if (frame.from === machineKey && verifySignature(machineKey, signalMessage(machineKey, key.publicKey, frame.envelope), frame.signature)) {
                client.receiveSignal(frame.envelope);
            }
        });
        await client.open();
        // Like the app: the broker socket is only for the signals.
        onTheBroker.socket.close();
        expect((await client.request<EndpointInfo>('endpoint.info', {})).authenticated).toBe(true);
        console.log(`direct channel through the broker: open after ${client.timings.channelOpenMs} ms, signed in after ${client.timings.authenticatedMs} ms`);

        let output = '';
        client.onFrame((raw) => {
            const frame = JSON.parse(raw) as { event?: string; payload?: { data?: string } };
            if (frame.event === 'session.output') {
                output += frame.payload?.data ?? '';
            }
        });
        const sessionId = `docker-broker-${Date.now()}`;
        await client.request<SessionInfo>('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        try {
            await client.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
            await client.request('session.write', { sessionId, data: 'echo brokered-$((6*7)) && uname -s\n' });
            await waitUntil('the shell to answer over the channel', () => output.includes('brokered-42') && output.includes('Linux'));

            broker!.kill();
            await broker!.exited;
            expect(await fetch(BROKER_HEALTH).catch(() => null)).toBeNull();
            await client.request('session.write', { sessionId, data: 'echo without-broker-$((6*7))\n' });
            await waitUntil('the shell to answer with the broker gone', () => output.includes('without-broker-42'));
            expect(client.isOpen).toBe(true);
        } finally {
            await client.request('session.kill', { sessionId }).catch(() => undefined);
        }
    }, 90_000);
});
