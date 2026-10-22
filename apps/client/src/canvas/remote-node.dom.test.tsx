import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatInfo, ChatItem, ProjectCanvasView, ProjectNode, ProviderInfo } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { groupAttention, useAttention } from '@/state/attention';
import { projectNodes } from '@/project/view-nodes';
import { useChats } from '@adecore/agents-react/state';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { windowWorkspace } from '@/state/window';
import { chatInfoOf } from '../../testing/chat-info';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { useUi } from '@/state/ui';
import { TransportError } from '@/transport/transport';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const REMOTE = 'machine-b';
const LOCAL_SHELL: ProjectNode = { id: 'local-shell', kind: 'terminal', title: 'Shell here', x: 0, y: 0, w: 560, h: 360 };
const REMOTE_SHELL: ProjectNode = { id: 'remote-shell', kind: 'terminal', title: 'Shell there', x: 600, y: 0, w: 560, h: 360, machine: REMOTE };
const REMOTE_CHAT: ProjectNode = { id: 'remote-chat', kind: 'chat', title: 'Chat there', x: 0, y: 400, w: 560, h: 480, machine: REMOTE, provider: 'claude' };
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [LOCAL_SHELL, REMOTE_SHELL, REMOTE_CHAT],
    texts: [],
    edges: [],
    layouts: []
};

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: {
        chat: true,
        terminal: true,
        hooks: true,
        streamsToolOutput: false,
        diffs: 'before-after',
        attachments: true,
        mentions: true,
        denyReason: true,
        allowAlways: true,
        asyncQuestions: false,
        compaction: 'none',
        reportsCost: false,
        reportsContextWindow: false,
        reportsThinking: false,
        slashCommands: true,
        steer: false
    },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

const APPROVAL = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0]! as ChatItem;

let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;
let seq = 0;

/* What the machine the chat runs on says about it, the way its stream does. */
async function tellFromThere(patch: Partial<ChatInfo>, items: ChatItem[] = []): Promise<void> {
    await act(async () => {
        for (const item of items) {
            seq += 1;
            there.emit('chat.event', { chatId: REMOTE_CHAT.id, event: { type: 'item', item }, seq });
        }
        seq += 1;
        there.emit('chat.event', { chatId: REMOTE_CHAT.id, event: { type: 'info', info: chatInfoOf(REMOTE_CHAT.id, patch) }, seq });
    });
}

beforeEach(async () => {
    here = new FakeMachine();
    here.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    here.answer('remote.list', () => ({ links: [{ machineId: REMOTE, remoteProjectId: 'remote-project', label: 'MacBook Pro', rootCommit: 'abc' }] }));
    there = new FakeMachine();
    there.answer('provider.list', () => ({ providers: [CLAUDE] }));
    there.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq }) as never);
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${REMOTE_SHELL.id}"] textarea`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    disconnectThere();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

describe('a node that runs on another machine', () => {
    test('a terminal attaches over the link of its own machine, and the project machine hears nothing of it', async () => {
        await until(() => there.requests('session.attach').some((request) => request.sessionId === REMOTE_SHELL.id));
        await until(() => here.requests('session.attach').some((request) => request.sessionId === LOCAL_SHELL.id));
        const aboutIt = (machine: FakeMachine): string[] =>
            machine.sent
                .filter((request) => request.type.startsWith('session.') && JSON.stringify(request.payload).includes(REMOTE_SHELL.id))
                .map((request) => request.type);
        expect(aboutIt(here)).toEqual([]);
        expect(there.requests('session.attach').map((request) => request.sessionId)).toEqual([REMOTE_SHELL.id]);
    });

    test('a permission card of its chat is answered over the machine the chat runs on', async () => {
        await until(() => there.requests('chat.attach').length > 0);
        await tellFromThere({ status: 'needs-you' }, [APPROVAL]);
        await until(() => page.host.querySelector('[data-prompt-stack]') !== null || document.querySelector('button') !== null);
        const allow = (): HTMLElement | null =>
            ([...page.host.querySelectorAll('button')] as HTMLElement[]).find((button) => /^Allow\b/.test(button.textContent?.trim() ?? '')) ?? null;
        await until(() => allow() !== null);
        await clickOn(allow());
        await until(() => there.requests('chat.approve').length === 1);
        expect(there.requests('chat.approve')[0]).toMatchObject({ chatId: REMOTE_CHAT.id, requestId: (APPROVAL as { requestId: string }).requestId });
        expect(here.requests('chat.approve')).toEqual([]);
    });

    test('a chat of its machine waiting on a person counts once', async () => {
        await until(() => there.requests('chat.attach').length > 0);
        await tellFromThere({ status: 'needs-you' }, [APPROVAL]);
        await until(() => useChats.getState().statusByKey[`${REMOTE}:${REMOTE_CHAT.id}`]?.info.status === 'needs-you');
        const groups = groupAttention(
            projectNodes(),
            useSessions.getState().byKey,
            useChats.getState().statusByKey,
            windowWorkspace()!.connection.endpointId,
            useAttention.getState().unseen,
            useSnoozes.getState().byKey
        );
        expect(groups.needsYou).toEqual([REMOTE_CHAT.id]);
    });

    test('is placed on its machine when the project opens, and its nodes end there, without closing the project, when it is closed here', async () => {
        await until(() => there.requests('peer.placeNodes').length > 0);
        expect(there.requests('peer.placeNodes')[0]).toMatchObject({
            projectId: 'remote-project',
            nodes: [{ id: REMOTE_SHELL.id }, { id: REMOTE_CHAT.id }],
            edges: []
        });
        expect(here.requests('peer.placeNodes')).toEqual([]);

        await act(async () => windowWorkspace()!.connection.projects.closeProject());
        expect(there.requests('peer.placeNodes').at(-1)).toMatchObject({ projectId: 'remote-project', nodes: [], edges: [] });
        expect(there.requests('project.release')).toEqual([{ projectId: 'remote-project' }]);
        expect(there.requests('project.close')).toEqual([]);
    });
});

function frame(id: string): Element {
    return page.host.querySelector(`[data-node-id="${id}"]`)!;
}

function cardOf(id: string): string | null {
    return frame(id).querySelector('[role="status"]')?.textContent ?? null;
}

describe('the machine of a node', () => {
    test('is named in the header of a node that runs elsewhere, and in none of the nodes that run here', async () => {
        expect(frame(REMOTE_SHELL.id).querySelector('header')?.textContent).toContain('MacBook Pro');
        expect(frame(REMOTE_CHAT.id).querySelector('header')?.textContent).toContain('MacBook Pro');
        expect(frame(LOCAL_SHELL.id).querySelector('header')?.textContent).not.toContain('MacBook Pro');
    });

    test('going away puts only the nodes that run there offline, while a terminal here keeps its shell', async () => {
        await act(async () => there.lose());
        await until(() => cardOf(REMOTE_SHELL.id) !== null && cardOf(REMOTE_CHAT.id) !== null);
        expect(cardOf(REMOTE_SHELL.id)).toContain('MacBook Pro is not answering. It may be asleep.');
        // Ruimte's own icon heads the card, the way it heads the window when the open project's machine goes.
        expect(frame(REMOTE_SHELL.id).querySelector('[role="status"] img')).not.toBeNull();
        expect(frame(REMOTE_SHELL.id).querySelector('textarea')).toBeNull();
        expect(frame(LOCAL_SHELL.id).querySelector('textarea')).not.toBeNull();
        expect(cardOf(LOCAL_SHELL.id)).toBeNull();
    });

    test('Retry asks for the link again, and the card goes when the machine answers', async () => {
        await act(async () => there.lose());
        await until(() => cardOf(REMOTE_SHELL.id) !== null);
        const retry = [...frame(REMOTE_SHELL.id).querySelectorAll('button')].find((button) => button.textContent === 'Try again') ?? null;
        await clickOn(retry);
        expect(there.reconnects).toBe(1);

        await act(async () => there.reopen());
        await until(() => cardOf(REMOTE_SHELL.id) === null);
    });

    test('older than the nodes need says so and offers nothing to press', async () => {
        await act(async () => there.answersOnly(['session.attach', 'chat.attach']));
        await until(() => cardOf(REMOTE_SHELL.id) !== null);
        expect(cardOf(REMOTE_SHELL.id)).toContain('MacBook Pro runs an older Ruimte. Update it to use this node.');
        expect(frame(REMOTE_SHELL.id).querySelectorAll('[role="status"] button')).toHaveLength(0);
    });

    test('a machine that no longer links the project says so, and Link again opens the dialog for it', async () => {
        there.answer('peer.placeNodes', () => {
            throw new TransportError('peer-not-linked', 'That machine has no link to this project');
        });
        // The machine forgot who holds the project with the link that did, so the window places its nodes again, and is refused.
        await act(async () => {
            there.drop();
            there.reopen();
        });
        await until(() => cardOf(REMOTE_SHELL.id) !== null);
        expect(cardOf(REMOTE_SHELL.id)).toContain('This project is no longer linked on MacBook Pro.');

        const again = [...frame(REMOTE_SHELL.id).querySelectorAll('button')].find((button) => button.textContent === 'Link again') ?? null;
        await clickOn(again);
        expect(useUi.getState().remoteNodeDialog).toMatchObject({ machineId: REMOTE, relink: true });
        await act(async () => useUi.getState().setRemoteNodeDialog(null));
    });
});
