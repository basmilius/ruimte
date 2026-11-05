import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatStore, claudeProjectSlug } from '@adecore/agents/chat';
import { ManualClock } from '@adecore/agents/testing';
import type { ChatTurnItem, ProjectCanvasView, ProjectContent, ProjectNode, RuntimeMode } from '@ruimte/contracts';
import { MAX_AGENT_DEPTH, MAX_OPENED_PER_CALLER } from '../canvas/depth.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, invokeTool, releasedProject, type TestDaemon } from '../tasks/test-daemon.ts';

function chatNode(id: string, title: string, x: number): ProjectNode {
    return { id, kind: 'chat', title, x, y: 0, w: 560, h: 640, provider: 'claude', providerFixed: true };
}

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [chatNode('chat-lead', 'Lead', 0), chatNode('chat-kid', 'Lexer', 600), chatNode('chat-other', 'Parser', 1200)],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

function turnsOf(daemon: TestDaemon, chatId: string): ChatTurnItem[] {
    return (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

describe('fork', () => {
    let root: string;
    let home: string;
    let folder: string;
    let store: ProjectStore;
    let projectId: string;
    let daemon: TestDaemon;

    beforeEach(async () => {
        ({ root, home, folder, store, projectId } = await releasedProject('ruimte-fork-tool-', content()));
        daemon = await bootTestDaemon({ home, store, clock: new ManualClock() });
        daemon.worker.start();
    });

    afterEach(async () => {
        await daemon.stop();
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });

    /* A chat with one finished turn, and the transcript Claude Code would have written for it. */
    const chatWithTurn = async (chatId: string, runtimeMode: RuntimeMode): Promise<void> => {
        await daemon.chats.create({ chatId, provider: 'claude', cwd: folder, runtimeMode });
        await daemon.chats.send(chatId, 'alpha');
        await daemon.until(() => daemon.chats.get(chatId)?.info.activeTurnId === null && turnsOf(daemon, chatId).length === 1);
        const sessionId = daemon.chats.get(chatId)!.info.agentSessionId!;
        const [turn] = turnsOf(daemon, chatId);
        const lines = [
            { type: 'user', uuid: 'prompt-0', isSidechain: false, sessionId, message: { role: 'user', content: 'alpha' } },
            { type: 'assistant', uuid: turn!.native!.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'echo' }] } }
        ];
        const dir = join(daemon.chats.claudeProjectsDir, claudeProjectSlug(folder));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((entry) => JSON.stringify(entry)).join('\n'));
    };

    /* The lead a person opened, in a narrower mode than the child it opened earlier runs in. */
    const leadWithChild = async (leadDepth = 0): Promise<void> => {
        if (leadDepth > 0) {
            await daemon.lineage.put({ projectId, nodeId: 'chat-lead', openedBy: 'chat-boss', depth: leadDepth, agent: true });
        }
        await daemon.lineage.put({ projectId, nodeId: 'chat-kid', openedBy: 'chat-lead', depth: leadDepth + 1, agent: true, ceiling: 'full-access' });
        await chatWithTurn('chat-lead', 'supervised');
        await chatWithTurn('chat-kid', 'full-access');
    };

    test('an agent forks a chat it opened into a child of its own beside the original, which takes a task from it', async () => {
        await leadWithChild();

        const lines = await invokeTool(daemon, 'chat-lead', 'agent_fork', { id: 'chat-kid', title: 'Lexer B' });
        const [, forkId, viewId, branch] = lines[0]!.split('\t');
        expect([lines[0]!.split('\t')[0], viewId, branch]).toEqual(['fork', 'main', '-']);
        expect(lines[1]).toBe(`next\tGive it work with task_new with id ${forkId} and a prompt; its result wakes you once it settled`);

        expect(daemon.lineage.startedBy(forkId!)).toBe('chat-lead');
        expect(daemon.lineage.madeBy(forkId!)).toBe('chat-lead');
        expect(daemon.lineage.depthOf(forkId!)).toBe(1);
        expect(daemon.lineage.forkedFrom(forkId!)).toBeNull();
        const record = (await new ChatStore(home).read(forkId!))!;
        expect(record.info.forkOf?.chatId).toBe('chat-kid');

        const canvas = (await store.read(projectId)).views[0] as ProjectCanvasView;
        expect(canvas.nodes.find((node) => node.id === forkId)).toMatchObject({ kind: 'chat', title: 'Lexer B' });
        expect(canvas.edges).toEqual([expect.objectContaining({ from: 'chat-kid', to: forkId })]);

        const [given] = await invokeTool(daemon, 'chat-lead', 'task_new', { id: forkId!, prompt: 'go on' });
        expect(given).toStartWith(`task\t`);
        expect(given!.split('\t')[2]).toBe(forkId!);
    });

    test('the fork of a hidden agent is a hidden agent of the one that forked it', async () => {
        await store.hiddenAgents.put({ projectId, openedBy: 'chat-lead', node: { ...chatNode('chat-hid', 'Scout', 0), kind: 'chat' } });
        await daemon.lineage.put({ projectId, nodeId: 'chat-hid', openedBy: 'chat-lead', depth: 1, agent: true, ceiling: 'supervised' });
        await chatWithTurn('chat-lead', 'supervised');
        await chatWithTurn('chat-hid', 'supervised');

        const [line] = await invokeTool(daemon, 'chat-lead', 'agent_fork', { id: 'chat-hid' });
        const [, forkId, viewId] = line!.split('\t');

        expect(viewId).toBe(forkId!);
        expect(store.hiddenAgents.get(forkId!)).toMatchObject({ projectId, openedBy: 'chat-lead', node: { kind: 'chat', title: 'Scout (fork)' } });
        expect(daemon.lineage.startedBy(forkId!)).toBe('chat-lead');
        expect(((await store.read(projectId)).views[0] as ProjectCanvasView).nodes).toHaveLength(3);
    });

    test('the fork runs no wider than the forking agent, whatever mode the original ran in', async () => {
        await leadWithChild();

        const [line] = await invokeTool(daemon, 'chat-lead', 'agent_fork', { id: 'chat-kid' });
        const forkId = line!.split('\t')[1]!;

        expect(daemon.lineage.ceilingOf(forkId)).toBe('supervised');
        expect((await new ChatStore(home).read(forkId))!.info.runtimeMode).toBe('supervised');
    });

    test('a chat the agent did not open is refused, its own chat and its opener included', async () => {
        await leadWithChild();
        await chatWithTurn('chat-other', 'supervised');

        expect((await invokeTool(daemon, 'chat-lead', 'agent_fork', { id: 'chat-other' }))[0]).toBe(
            'refused\tnot-yours\tchat-other is not a node you opened; you only fork a chat you opened yourself'
        );
        expect((await invokeTool(daemon, 'chat-kid', 'agent_fork', { id: 'chat-lead' }))[0]).toStartWith('refused\tnot-yours\t');
        expect((await invokeTool(daemon, 'chat-lead', 'agent_fork', { id: 'chat-lead' }))[0]).toStartWith('refused\tself-fork\t');
        expect(((await store.read(projectId)).views[0] as ProjectCanvasView).nodes.map((node) => node.id)).toEqual(['chat-lead', 'chat-kid', 'chat-other']);
    });

    test('the fork lands one deeper than the forking agent, and is refused past the depth limit', async () => {
        await leadWithChild(MAX_AGENT_DEPTH);

        const [refused] = await invokeTool(daemon, 'chat-lead', 'agent_fork', { id: 'chat-kid' });
        expect(refused).toBe(
            `refused\ttoo-deep\tYou sit at depth ${MAX_AGENT_DEPTH} and agent_start would open agents at depth ${MAX_AGENT_DEPTH + 1}; agent_start opens up to depth ${MAX_AGENT_DEPTH}`
        );
        expect(((await store.read(projectId)).views[0] as ProjectCanvasView).nodes).toHaveLength(3);
    });

    test('the fork counts against the agents one caller may have open', async () => {
        await leadWithChild();
        for (let i = 1; i < MAX_OPENED_PER_CALLER; i++) {
            await daemon.lineage.put({ projectId, nodeId: `chat-held-${i}`, openedBy: 'chat-lead', depth: 1, agent: true });
        }

        const [refused] = await invokeTool(daemon, 'chat-lead', 'agent_fork', { id: 'chat-kid' });
        expect(refused).toStartWith(`refused\ttoo-many-agents\tYou have ${MAX_OPENED_PER_CALLER} agents open and this would open 1 more`);
    });
});
