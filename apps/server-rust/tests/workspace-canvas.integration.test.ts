import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repositoryRoot, RpcFailure, startDaemon } from './wire-client';

test('native team, worktree and strict diagram verbs preserve their transaction boundaries', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-native-canvas-'));
    const home = join(temporary, 'home');
    const bin = join(temporary, 'bin');
    const tokens = join(temporary, 'tokens');
    const targetTokenFile = join(temporary, 'target-token');
    const folder = join(temporary, 'repo');
    await mkdir(home);
    await mkdir(bin);
    await mkdir(tokens);
    await mkdir(folder);
    await installClaude(bin, tokens);
    await git(folder, ['init', '-b', 'main']);
    await git(folder, ['config', 'user.name', 'Fixture']);
    await git(folder, ['config', 'user.email', 'fixture@example.invalid']);
    await writeFile(join(folder, 'base.txt'), 'base\n');
    await git(folder, ['add', '.']);
    await git(folder, ['commit', '-m', 'base']);
    const daemon = await startDaemon({
        home,
        env: {
            PATH: `${bin}:${process.env.PATH}`,
            RUIMTE_CONTEXT_TOKEN: '',
            RUIMTE_CONTEXT_URL: '',
            RUIMTE_HOOK_TOKEN: '',
            RUIMTE_HOOK_URL: '',
            RUIMTE_SESSION_ID: ''
        }
    });
    const client = await daemon.connect();

    try {
        const opened = await client.call('project.open', { folder });
        const projectId = opened.summary.projectId as string;
        await client.call('project.save', {
            projectId,
            baseRev: opened.document.rev,
            content: {
                name: 'Canvas regression',
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
                            },
                            {
                                id: 'terminal-target',
                                kind: 'terminal',
                                title: 'Target shell',
                                x: 700,
                                y: 0,
                                w: 560,
                                h: 360
                            }
                        ],
                        edges: [{ id: 'notify-edge', from: 'chat-parent', to: 'terminal-target' }],
                        layouts: [],
                        texts: []
                    }
                ]
            }
        });
        await client.call('session.create', {
            sessionId: 'terminal-target',
            cols: 80,
            rows: 24,
            shell: '/bin/sh',
            command: `printf '%s' "$RUIMTE_HOOK_TOKEN" > '${targetTokenFile}'; sleep 30`
        });
        await client.call('chat.create', { chatId: 'chat-parent', provider: 'claude', cwd: folder, runtimeMode: 'supervised' });
        await client.call('chat.send', { chatId: 'chat-parent', text: 'hello' });
        await waitFor(async () => {
            const attached = await client.call('chat.attach', { chatId: 'chat-parent' });
            return attached.info.activeTurnId === null && attached.items.some((item: any) => item.kind === 'assistant');
        });
        const parentToken = await firstToken(tokens);
        const project = async () => (await client.call('project.open', { projectId })).document;

        const notice = await canvas(daemon.base, parentToken, 'notify', ['terminal-target', '--text', 'the build is green']);
        expect(notice.status).toBe(200);
        expect(await notice.text()).toContain('\tnow\t');
        const targetScreen = await client.call('session.attach', { sessionId: 'terminal-target', follow: true });
        expect(targetScreen.screen).toContain('the build is green');

        const targetToken = await waitFor(async () => {
            const token = await readFile(targetTokenFile, 'utf8').catch(() => '');
            return token || null;
        });
        const targetHook = () =>
            fetch(`${daemon.base}/hooks/claude`, {
                method: 'POST',
                headers: { authorization: `Bearer ${targetToken}`, 'content-type': 'application/json' },
                body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'target-conversation' })
            });
        expect((await targetHook()).status).toBe(200);
        const queuedNotice = await canvas(daemon.base, parentToken, 'notify', ['terminal-target', '--text', 'deliver on the next turn']);
        expect(queuedNotice.status).toBe(200);
        expect(await queuedNotice.text()).toContain('\twaiting\t');
        const firstHook = await targetHook();
        const secondHook = await targetHook();
        expect(await firstHook.text()).toContain('deliver on the next turn');
        expect(await secondHook.text()).not.toContain('deliver on the next turn');

        const roles = [
            { title: 'First', prompt: 'hello', provider: 'claude' },
            { title: 'Second', prompt: 'hello', provider: 'claude' }
        ];
        const beforeTeam = await project();
        expect((await canvas(daemon.base, parentToken, 'team', ['--label', 'Research', '--roles', JSON.stringify(roles), '--dry-run'])).status).toBe(200);
        expect((await project()).rev).toBe(beforeTeam.rev);
        const invalidTeam = await canvas(daemon.base, parentToken, 'team', [
            '--label',
            'Invalid',
            '--roles',
            JSON.stringify([roles[0], { ...roles[1], unknown: true }])
        ]);
        expect(invalidTeam.status).toBe(422);
        expect((await project()).rev).toBe(beforeTeam.rev);
        expect((await canvas(daemon.base, parentToken, 'team', ['--label', 'Research', '--roles', JSON.stringify(roles)])).status).toBe(200);
        const afterTeam = await project();
        const main = afterTeam.views.find((view: any) => view.id === 'main');
        expect(main.nodes.filter((node: any) => roles.some((role) => role.title === node.title))).toHaveLength(2);
        expect(main.nodes.some((node: any) => node.kind === 'group' && node.title === 'Research')).toBe(true);

        const openedWorker = await canvas(daemon.base, parentToken, 'agent', [
            'claude',
            '--prompt',
            'slow',
            '--title',
            'Worktree worker',
            '--worktree',
            '--branch',
            'fixture-worker'
        ]);
        expect(openedWorker.status).toBe(200);
        const worker = await waitFor(async () => {
            const content = await project();
            return content.views.flatMap((view: any) => view.nodes ?? []).find((node: any) => node.title === 'Worktree worker') ?? null;
        });
        await writeFile(join(worker.cwd, 'new-file.txt'), 'first\nsecond\n');
        await writeFile(join(worker.cwd, 'base.txt'), 'updated base\n');
        await waitFor(async () => (await client.call('chat.attach', { chatId: worker.id })).info.activeTurnId !== null);
        const merge = {
            repo: folder,
            path: worker.cwd,
            actionId: 'busy-merge',
            strategy: 'squash',
            commitFirst: true,
            subject: 'Person fixture work'
        };
        let refusal: RpcFailure | null = null;
        try {
            await client.call('git.worktree-merge', merge);
        } catch (error) {
            refusal = error as RpcFailure;
        }
        expect(refusal?.error.code).toBe('agent-working');
        const merged = await client.call('git.worktree-merge', { ...merge, actionId: 'stop-merge', stopAgent: true });
        expect(merged.summary).toBe('Squashed fixture-worker into main.');
        expect(await readFile(join(folder, 'base.txt'), 'utf8')).toBe('updated base\n');
        expect(await readFile(join(folder, 'new-file.txt'), 'utf8')).toBe('first\nsecond\n');

        const createdView = await canvas(daemon.base, parentToken, 'view', ['new', 'Workflow', '--kind', 'diagram']);
        expect(createdView.status).toBe(200);
        const viewId = (await createdView.text()).split('\t')[0];
        const diagram = {
            meta: { title: 'Workflow', direction: 'right' },
            nodes: [
                { id: 'one', label: 'First' },
                { id: 'two', label: 'Second' }
            ],
            groups: [],
            edges: [{ from: 'one', to: 'two' }]
        };
        expect((await canvas(daemon.base, parentToken, 'view', ['diagram', viewId, '--document', JSON.stringify(diagram)])).status).toBe(200);
        const saved = await client.call('diagram.open', { projectId, viewId });
        const invalidDiagram = await canvas(daemon.base, parentToken, 'view', [
            'diagram',
            viewId,
            '--document',
            JSON.stringify({ ...diagram, nodes: [{ id: 'one', label: 'First', typo: true }, diagram.nodes[1]] })
        ]);
        expect(invalidDiagram.status).toBe(422);
        expect((await client.call('diagram.open', { projectId, viewId })).rev).toBe(saved.rev);
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 90_000);

const installClaude = async (bin: string, tokens: string): Promise<void> => {
    const executable = join(bin, 'claude');
    await writeFile(
        executable,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'fixture 1.0.0'; exit 0; fi
if [ -n "$RUIMTE_CONTEXT_TOKEN" ]; then printf '%s' "$RUIMTE_CONTEXT_TOKEN" > '${tokens}/'$$; fi
exec '${process.execPath}' '${join(repositoryRoot, 'apps/server-rust/tests/providers/fake-claude.ts')}' "$@"
`
    );
    await chmod(executable, 0o755);
};

const canvas = (base: string, token: string, verb: string, argv: string[]): Promise<Response> =>
    fetch(`${base}/canvas/${verb}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ argv })
    });

const firstToken = async (directory: string): Promise<string> =>
    waitFor(async () => {
        const files = await readdir(directory);
        return files.length ? (await readFile(join(directory, files[0]), 'utf8')).trim() : null;
    });

const git = async (cwd: string, args: string[]): Promise<void> => {
    const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stderr, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);
    if (code !== 0) {
        throw new Error(stderr);
    }
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
