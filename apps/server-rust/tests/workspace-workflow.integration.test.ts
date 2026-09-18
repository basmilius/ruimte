import { expect, test } from 'bun:test';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repositoryRoot, startDaemon } from './wire-client';

test('a native child settles naturally and wakes its busy parent once', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-native-task-'));
    const home = join(temporary, 'home');
    const bin = join(temporary, 'bin');
    const tokens = join(temporary, 'tokens');
    await mkdir(home);
    await mkdir(bin);
    await mkdir(tokens);
    await installProvider(bin, tokens, 'claude');
    const daemon = await startDaemon({
        home,
        env: cleanAgentEnvironment(bin, tokens)
    });
    const client = await daemon.connect();

    try {
        const folder = join(temporary, 'project');
        await mkdir(folder);
        const opened = await client.call('project.open', { folder });
        const projectId = opened.summary.projectId as string;
        await client.call('project.save', {
            projectId,
            baseRev: opened.document.rev,
            content: {
                name: 'Native task',
                color: '#353e53',
                views: [
                    {
                        id: 'main',
                        kind: 'canvas',
                        name: 'Main',
                        nodes: [
                            {
                                id: 'chat-parent',
                                kind: 'chat',
                                title: 'Parent',
                                provider: 'claude',
                                providerFixed: true,
                                x: 0,
                                y: 0,
                                w: 560,
                                h: 640
                            }
                        ],
                        edges: [],
                        layouts: [],
                        texts: []
                    }
                ]
            }
        });
        await client.call('chat.create', { chatId: 'chat-parent', provider: 'claude', cwd: folder, runtimeMode: 'supervised' });
        await client.call('chat.send', { chatId: 'chat-parent', text: 'hello' });
        await waitFor(async () => {
            const attached = await client.call('chat.attach', { chatId: 'chat-parent' });
            return attached.info.activeTurnId === null && attached.items.some((item: any) => item.kind === 'assistant');
        });
        const parentToken = (await readFile(join(tokens, 'claude'), 'utf8')).trim().split('\n').at(-1)!;
        await client.call('chat.send', { chatId: 'chat-parent', text: 'slow' });
        await waitFor(async () => (await client.call('chat.attach', { chatId: 'chat-parent' })).info.activeTurnId !== null);

        const openedAgent = await canvas(daemon.base, parentToken, 'agent', ['claude', '--prompt', 'hello', '--task', 'Review fixture', '--title', 'Worker']);
        expect(openedAgent.status).toBe(200);

        const tasks = await waitFor(async () => {
            const values = await diskObjects(join(home, 'tasks'));
            return values.some((task) => task.status === 'done' && task.wake === 'pending') ? values : null;
        });
        expect(tasks).toHaveLength(1);
        const task = tasks[0];
        await client.call('chat.cancel', { chatId: 'chat-parent' });
        const parent = await waitFor(async () => {
            const attached = await client.call('chat.attach', { chatId: 'chat-parent' });
            return attached.items.some((item: any) => item.kind === 'turn' && item.taskIds?.includes(task.id)) ? attached : null;
        });
        expect(parent.items.filter((item: any) => item.kind === 'turn' && item.taskIds?.includes(task.id))).toHaveLength(1);
        expect(
            parent.items.some((item: any) => item.kind === 'subagent' && item.origin === 'ruimte' && item.childId === task.childId && item.status === 'done')
        ).toBe(true);
        expect(await diskObjects(join(home, 'outbox'))).toHaveLength(0);
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

test('pending work resumes once through a headless native restart', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-native-switch-'));
    const home = join(temporary, 'home');
    const bin = join(temporary, 'bin');
    const tokens = join(temporary, 'tokens');
    await mkdir(home);
    await mkdir(bin);
    await mkdir(tokens);
    await installProvider(bin, tokens, 'claude');
    const environment = cleanAgentEnvironment(bin, tokens);
    let projectId = '';
    let taskId = '';
    let interruptedTurn = '';

    try {
        const first = await startDaemon({ home, env: environment });
        const client = await first.connect();
        try {
            const folder = join(temporary, 'project');
            await mkdir(folder);
            const opened = await client.call('project.open', { folder });
            projectId = opened.summary.projectId;
            await client.call('project.save', {
                projectId,
                baseRev: opened.document.rev,
                content: {
                    name: 'Pending switch',
                    color: '#353e53',
                    views: [
                        {
                            id: 'main',
                            kind: 'canvas',
                            name: 'Main',
                            nodes: [
                                {
                                    id: 'chat-parent',
                                    kind: 'chat',
                                    title: 'Parent',
                                    provider: 'claude',
                                    providerFixed: true,
                                    x: 0,
                                    y: 0,
                                    w: 560,
                                    h: 640
                                }
                            ],
                            edges: [],
                            layouts: [],
                            texts: []
                        }
                    ]
                }
            });
            await client.call('chat.create', { chatId: 'chat-parent', provider: 'claude', cwd: folder, runtimeMode: 'supervised' });
            await client.call('chat.send', { chatId: 'chat-parent', text: 'hello' });
            await waitFor(async () => {
                const attached = await client.call('chat.attach', { chatId: 'chat-parent' });
                return attached.info.activeTurnId === null && attached.items.some((item: any) => item.kind === 'assistant');
            });
            const parentToken = (await readFile(join(tokens, 'claude'), 'utf8')).trim().split('\n').at(-1)!;
            await client.call('chat.send', { chatId: 'chat-parent', text: 'slow' });
            interruptedTurn = await waitFor(async () => (await client.call('chat.attach', { chatId: 'chat-parent' })).info.activeTurnId);
            const response = await canvas(first.base, parentToken, 'agent', ['claude', '--prompt', 'hello', '--task', 'Durable task', '--title', 'Worker']);
            expect(response.status).toBe(200);
            const tasks = await waitFor(async () => {
                const values = await diskObjects(join(home, 'tasks'));
                return values.some((task) => task.status === 'done' && task.wake === 'pending') ? values : null;
            });
            taskId = tasks[0].id;
            await client.call('project.release', { projectId });
        } finally {
            client.close();
            await first.stop();
        }

        const rust = await startDaemon({ home, env: environment });
        const rustClient = await rust.connect();
        try {
            await rustClient.call('chat.create', { chatId: 'chat-parent' });
            const parent = await waitFor(async () => {
                const attached = await rustClient.call('chat.attach', { chatId: 'chat-parent' });
                const resumed = attached.items.find((item: any) => item.id === interruptedTurn);
                const wake = attached.items.filter((item: any) => item.kind === 'turn' && item.taskIds?.includes(taskId));
                return resumed?.state === 'done' && resumed.attempt === 2 && wake.length === 1 ? attached : null;
            });
            expect(parent.items.filter((item: any) => item.kind === 'turn' && item.taskIds?.includes(taskId))).toHaveLength(1);
            expect((await diskObjects(join(home, 'tasks')))[0]?.wake).toBe('sent');
            expect(rustClient.violations).toEqual([]);
        } finally {
            rustClient.close();
            await rust.stop();
        }

        const last = await startDaemon({ home, env: environment });
        const lastClient = await last.connect();
        try {
            await lastClient.call('chat.create', { chatId: 'chat-parent' });
            const parent = await lastClient.call('chat.attach', { chatId: 'chat-parent' });
            expect(parent.items.find((item: any) => item.id === interruptedTurn)?.attempt).toBe(2);
            expect(parent.items.filter((item: any) => item.kind === 'turn' && item.taskIds?.includes(taskId))).toHaveLength(1);
            expect(lastClient.violations).toEqual([]);
        } finally {
            lastClient.close();
            await last.stop();
        }
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}, 90_000);

test('a completed fork summary is delivered to its source chat', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-native-summary-'));
    const home = join(temporary, 'home');
    const bin = join(temporary, 'bin');
    const tokens = join(temporary, 'tokens');
    const folder = join(temporary, 'repo');
    await mkdir(home);
    await mkdir(bin);
    await mkdir(tokens);
    await mkdir(folder);
    await installProvider(bin, tokens, 'claude');
    await git(folder, ['init', '-b', 'main']);
    await git(folder, ['config', 'user.name', 'Fixture']);
    await git(folder, ['config', 'user.email', 'fixture@example.invalid']);
    await writeFile(join(folder, 'base.txt'), 'base\n');
    await git(folder, ['add', '.']);
    await git(folder, ['commit', '-m', 'base']);
    const daemon = await startDaemon({ home, env: cleanAgentEnvironment(bin, tokens) });
    const client = await daemon.connect();

    try {
        const opened = await client.call('project.open', { folder });
        await client.call('project.save', {
            projectId: opened.summary.projectId,
            baseRev: opened.document.rev,
            content: {
                name: 'Summary fixture',
                color: '#353e53',
                views: [
                    {
                        id: 'main',
                        kind: 'canvas',
                        name: 'Main',
                        nodes: [
                            {
                                id: 'chat-source',
                                kind: 'chat',
                                title: 'Source',
                                provider: 'claude',
                                providerFixed: true,
                                x: 0,
                                y: 0,
                                w: 560,
                                h: 640
                            }
                        ],
                        edges: [],
                        layouts: [],
                        texts: []
                    }
                ]
            }
        });
        await client.call('chat.create', { chatId: 'chat-source', provider: 'claude', cwd: folder, runtimeMode: 'supervised' });
        await sendAndWait(client, 'chat-source', 'write: first.txt from source');
        const source = await sendAndWait(client, 'chat-source', 'write: second.txt from source');
        const turns = source.items.filter((item: any) => item.kind === 'turn');
        const sessionId = source.info.agentSessionId as string;
        const transcriptDirectory = join(home, 'claude', 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'));
        await mkdir(transcriptDirectory, { recursive: true });
        const transcript = turns.flatMap((turn: any, index: number) => [
            { type: 'user', uuid: `prompt-${index}`, isSidechain: false, sessionId, message: { role: 'user', content: `turn ${index}` } },
            { type: 'assistant', uuid: turn.native.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'done' }] } }
        ]);
        await writeFile(join(transcriptDirectory, `${sessionId}.jsonl`), `${transcript.map((line: unknown) => JSON.stringify(line)).join('\n')}\n`);

        const fork = await client.call('chat.fork', {
            chatId: 'chat-source',
            turnId: turns[0].id,
            filesAfterTurn: true
        });
        await client.call('chat.create', { chatId: fork.nodeId });
        await sendAndWait(client, fork.nodeId, 'hello');
        await client.call('chat.summarize', { chatId: fork.nodeId });
        const parent = await waitFor(async () => {
            const attached = await client.call('chat.attach', { chatId: 'chat-source' });
            return attached.items.some((item: any) => item.kind === 'note' && item.text?.includes('summary')) ? attached : null;
        });
        expect(parent.items.some((item: any) => item.kind === 'note' && item.text?.includes('summary'))).toBe(true);
        expect(await diskObjects(join(home, 'outbox'))).toHaveLength(0);
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

test('removing an unused fork prunes its snapshot and transcript but keeps its worktree and source transcript', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-native-fork-prune-'));
    const home = join(temporary, 'home');
    const bin = join(temporary, 'bin');
    const tokens = join(temporary, 'tokens');
    const folder = join(temporary, 'repo');
    await mkdir(home);
    await mkdir(bin);
    await mkdir(tokens);
    await mkdir(folder);
    await installProvider(bin, tokens, 'claude');
    await git(folder, ['init', '-b', 'main']);
    await git(folder, ['config', 'user.name', 'Fixture']);
    await git(folder, ['config', 'user.email', 'fixture@example.invalid']);
    await writeFile(join(folder, 'base.txt'), 'base\n');
    await git(folder, ['add', '.']);
    await git(folder, ['commit', '-m', 'base']);
    const daemon = await startDaemon({ home, env: cleanAgentEnvironment(bin, tokens) });
    const client = await daemon.connect();

    try {
        const opened = await client.call('project.open', { folder });
        const projectId = opened.summary.projectId as string;
        await client.call('project.save', {
            projectId,
            baseRev: opened.document.rev,
            content: {
                name: 'Fork prune fixture',
                color: '#353e53',
                views: [
                    {
                        id: 'main',
                        kind: 'canvas',
                        name: 'Main',
                        nodes: [
                            {
                                id: 'chat-source',
                                kind: 'chat',
                                title: 'Source',
                                provider: 'claude',
                                providerFixed: true,
                                x: 0,
                                y: 0,
                                w: 560,
                                h: 640
                            }
                        ],
                        edges: [],
                        layouts: [],
                        texts: []
                    }
                ]
            }
        });
        await client.call('chat.create', { chatId: 'chat-source', provider: 'claude', cwd: folder, runtimeMode: 'supervised' });
        await sendAndWait(client, 'chat-source', 'write: first.txt from source');
        const source = await sendAndWait(client, 'chat-source', 'write: second.txt from source');
        const turns = source.items.filter((item: any) => item.kind === 'turn');
        const sessionId = source.info.agentSessionId as string;
        const transcriptDirectory = join(home, 'claude', 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'));
        const sourceTranscript = join(transcriptDirectory, `${sessionId}.jsonl`);
        await mkdir(transcriptDirectory, { recursive: true });
        const transcript = turns.flatMap((turn: any, index: number) => [
            { type: 'user', uuid: `prompt-${index}`, isSidechain: false, sessionId, message: { role: 'user', content: `turn ${index}` } },
            { type: 'assistant', uuid: turn.native.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'done' }] } }
        ]);
        await writeFile(sourceTranscript, `${transcript.map((line: unknown) => JSON.stringify(line)).join('\n')}\n`);

        const fork = await client.call('chat.fork', {
            chatId: 'chat-source',
            turnId: turns[0].id,
            worktree: {},
            filesAfterTurn: true
        });
        const snapshotFile = join(home, 'chats', `${fork.nodeId}.json`);
        const stored = JSON.parse(await readFile(snapshotFile, 'utf8'));
        const forkTranscript = join(home, 'claude', 'projects', stored.info.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${stored.info.agentSessionId}.jsonl`);
        expect(await pathExists(snapshotFile)).toBe(true);
        expect(await pathExists(forkTranscript)).toBe(true);

        const project = (await client.call('project.open', { projectId })).document;
        const views = project.views.map((view: any) =>
            view.kind === 'canvas'
                ? {
                      ...view,
                      nodes: view.nodes.filter((node: any) => node.id !== fork.nodeId),
                      edges: view.edges.filter((edge: any) => edge.from !== fork.nodeId && edge.to !== fork.nodeId)
                  }
                : view
        );
        await client.call('project.save', {
            projectId,
            baseRev: project.rev,
            content: { name: project.name, color: project.color, views }
        });
        await waitFor(async () => (!(await pathExists(snapshotFile)) ? true : null));

        expect(await pathExists(forkTranscript)).toBe(false);
        expect(await pathExists(join(fork.worktree.path, '.git'))).toBe(true);
        expect(await pathExists(sourceTranscript)).toBe(true);
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

const installProvider = async (bin: string, tokens: string, provider: 'claude' | 'codex'): Promise<void> => {
    const executable = join(bin, provider);
    await writeFile(
        executable,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'fixture 1.0.0'; exit 0; fi
if [ -n "$RUIMTE_CONTEXT_TOKEN" ]; then printf '%s\\n' "$RUIMTE_CONTEXT_TOKEN" >> '${tokens}/${provider}'; fi
exec '${process.execPath}' '${join(repositoryRoot, `apps/server-rust/tests/providers/fake-${provider}.ts`)}' "$@"
`
    );
    await chmod(executable, 0o755);
};

const cleanAgentEnvironment = (bin: string, tokens: string): Record<string, string> => ({
    PATH: `${bin}:${process.env.PATH}`,
    FIXTURE_TOKENS: tokens,
    RUIMTE_CONTEXT_TOKEN: '',
    RUIMTE_CONTEXT_URL: '',
    RUIMTE_HOOK_TOKEN: '',
    RUIMTE_HOOK_URL: '',
    RUIMTE_SESSION_ID: ''
});

const canvas = async (base: string, token: string, verb: string, argv: string[]): Promise<Response> =>
    fetch(`${base}/canvas/${verb}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ argv })
    });

const diskObjects = async (directory: string): Promise<any[]> => {
    const files = await readdir(directory).catch(() => []);
    const reads = await Promise.allSettled(files.filter((file) => file.endsWith('.json')).map((file) => Bun.file(join(directory, file)).json()));
    return reads.flatMap((read) => (read.status === 'fulfilled' ? [read.value] : []));
};

const pathExists = async (path: string): Promise<boolean> =>
    access(path).then(
        () => true,
        () => false
    );

const git = async (cwd: string, args: string[]): Promise<void> => {
    const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stderr, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);
    if (code !== 0) {
        throw new Error(stderr);
    }
};

const sendAndWait = async (client: any, chatId: string, text: string): Promise<any> => {
    await client.call('chat.send', { chatId, text });
    return waitFor(async () => {
        const attached = await client.call('chat.attach', { chatId });
        const lastTurn = attached.items.filter((item: any) => item.kind === 'turn').at(-1);
        return attached.info.activeTurnId === null && lastTurn?.checkpointAfter ? attached : null;
    });
};

const waitFor = async <T>(read: () => Promise<T | null | false>): Promise<T> => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const value = await read();
        if (value) {
            return value;
        }
        await Bun.sleep(30);
    }
    throw new Error('Condition timed out');
};
