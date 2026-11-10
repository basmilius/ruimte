import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { projectOverlays } from '../projects/overlays.ts';
import type { PeerLinks } from '../projects/peer-links.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, invokeTool, turnsOf, type TestDaemon } from '../testing/test-daemon.ts';

let root: string;
let folder: string;
let store: ProjectStore;
let daemon: TestDaemon;
let links: PeerLinks;
let projectId: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-peer-config-'));
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'), projectLinks(), projectOverlays(join(root, 'home')));
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, {
        name: 'repo',
        color: '#123456',
        views: [{ kind: 'chat', id: 'chat-lead', name: 'Lead', node: { provider: 'claude' } }]
    });
    links = store.peers;
    daemon = await bootTestDaemon({ home: join(root, 'home'), store, clock: new ManualClock(), installed: ['claude', 'codex'] });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function say(chatId: string): Promise<void> {
    await daemon.chats.send(chatId, 'hello');
    await daemon.until(() => daemon.chats.get(chatId)?.info.activeTurnId === null && turnsOf(daemon, chatId).length === 1);
}

describe('the configuration a chat CLI loads from its folder', () => {
    test('a chat of this machine loads it as always', async () => {
        await daemon.chats.create({ chatId: 'chat-own', provider: 'claude', cwd: folder });
        await say('chat-own');
        expect(daemon.chatCommands.at(-1)).not.toContain('--setting-sources=user');
        expect(daemon.chatCommands.at(-1)).not.toContain('--strict-mcp-config');
    });

    test('a chat that another machine gave its task never loads what the files it sent carry', async () => {
        await daemon.lineage.put({
            projectId,
            nodeId: 'chat-peer',
            openedBy: 'peer:machine-a:parent',
            depth: 1,
            agent: true,
            peer: { machineId: 'machine-a' }
        });
        await store.hiddenAgents.put({
            projectId,
            openedBy: 'peer:machine-a:parent',
            node: { id: 'chat-peer', kind: 'chat', title: 'Peer', x: 0, y: 0, w: 480, h: 560 }
        });
        await daemon.chats.create({ chatId: 'chat-peer', provider: 'claude', cwd: folder });
        await say('chat-peer');
        expect(daemon.chatCommands.at(-1)).toContain('--setting-sources=user');
        expect(daemon.chatCommands.at(-1)).toContain('--strict-mcp-config');
        // The strict flag keeps the servers on the line, so Ruimte's own stays, with the token's variable and never the token.
        const command = daemon.chatCommands.at(-1)!;
        expect(command[command.indexOf('--mcp-config') + 1]).toBe(
            '{"mcpServers":{"ruimte":{"type":"http","url":"http://127.0.0.1:4210/mcp","headers":{"Authorization":"Bearer ${RUIMTE_CONTEXT_TOKEN}"}}}}'
        );
        expect(command).toContain('--allowedTools=mcp__ruimte__*');
        expect(daemon.chatEnvs.at(-1)).toMatchObject({ RUIMTE_MCP_URL: 'http://127.0.0.1:4210/mcp', RUIMTE_CONTEXT_TOKEN: expect.any(String) });
    });

    test('an agent that a peer chat opened never loads them either, however deep', async () => {
        await daemon.lineage.put({
            projectId,
            nodeId: 'chat-lead',
            openedBy: 'peer:machine-a:parent',
            depth: 1,
            agent: true,
            peer: { machineId: 'machine-a' }
        });
        const [line] = await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'claude', prompt: 'look around' });
        const childId = line!.split('\t')[0]!;
        expect(daemon.host.untrusted?.node(childId)).toBe(true);
        await daemon.until(() => daemon.chatCommands.length > 0);
        expect(daemon.chatCommands.at(-1)).toContain('--setting-sources=user');
        expect(daemon.chatCommands.at(-1)).toContain('--strict-mcp-config');
    });

    test('a chat of this machine that works in a folder made from a peer task never loads them', async () => {
        const worktree = join(root, 'worktrees', 'task');
        await mkdir(worktree, { recursive: true });
        await links.bind('machine-a', 'Studio', projectId);
        await links.recordTask('machine-a', 'chat-given', { projectId, cwd: worktree, worktree: true });
        await daemon.chats.create({ chatId: 'chat-own', provider: 'claude', cwd: worktree });
        await say('chat-own');
        expect(daemon.chatCommands.at(-1)).toContain('--setting-sources=user');
    });
});

describe('what an untrusted caller or folder may start', () => {
    async function peerLead(): Promise<void> {
        await daemon.lineage.put({
            projectId,
            nodeId: 'chat-lead',
            openedBy: 'peer:machine-a:parent',
            depth: 0,
            agent: true,
            peer: { machineId: 'machine-a' }
        });
    }

    test('a caller that came from a peer opens no Codex chat and no terminal agent', async () => {
        await peerLead();
        expect((await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'codex', prompt: 'x' }))[0]).toStartWith('refused\tuntrusted-folder\t');
        expect((await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'claude', terminal: true, prompt: 'x' }))[0]).toStartWith(
            'refused\tuntrusted-folder\t'
        );
        const roles = JSON.stringify([{ title: 'Counter', prompt: 'count', provider: 'codex' }]);
        expect((await invokeTool(daemon, 'chat-lead', 'agent_team', { label: 'Counters', roles }))[0]).toStartWith('refused\tuntrusted-folder\t');
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a caller of this machine opens none of them into a folder made from a peer task', async () => {
        const worktree = join(folder, 'task');
        await mkdir(worktree, { recursive: true });
        await links.bind('machine-a', 'Studio', projectId);
        await links.recordTask('machine-a', 'chat-given', { projectId, cwd: worktree, worktree: true });
        const refused = await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'codex', cwd: worktree, prompt: 'x', dry_run: true });
        expect(refused[0]).toStartWith('refused\tuntrusted-folder\t');
        const own = await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'codex', prompt: 'x', dry_run: true });
        expect(own[0]).toStartWith('dry-run\t');
    });
});
