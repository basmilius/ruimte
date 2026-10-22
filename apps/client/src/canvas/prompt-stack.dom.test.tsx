import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatApprovalItem, ChatInfo, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const WRITER: ProjectNode = { id: 'writer', kind: 'chat', title: 'Writer', x: 40, y: 80, w: 480, h: 520 };
const TEAM: ProjectNode = { id: 'team', kind: 'group', title: 'Team', x: 0, y: 0, w: 600, h: 700, memberIds: [WRITER.id] };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [TEAM, WRITER], texts: [], edges: [], layouts: [] };

const SAMPLE = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0] as ChatApprovalItem;
const WRITE: ChatApprovalItem = { ...SAMPLE, id: 'approval-write', requestId: 'write', decision: 'pending', createdAt: 100 };

const WAITING: ChatInfo = chatInfoOf(WRITER.id, {
    status: 'needs-you',
    requests: [{ requestId: WRITE.requestId, itemId: WRITE.id, kind: 'approval', createdAt: WRITE.createdAt }]
});

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function stackCard(): Element | null {
    return document.querySelector(`[data-prompt-stack="${MAIN.id}"] .prompt-card`);
}

function collapseButton(): HTMLElement | null {
    return page.host.querySelector(`[data-node-id="${TEAM.id}"] button[aria-label="Collapse"]`);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatId === WRITER.id ? WAITING : chatInfoOf(chatId), items: chatId === WRITER.id ? [WRITE] : [] }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => stackCard() !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the prompt stack of a canvas', () => {
    test('lets go of a request answered while its chat was out of view, though the thread it held still says it waits', async () => {
        await until(() => collapseButton() !== null);
        await clickOn(collapseButton());
        await until(() => machine.requests('chat.detach').some((payload) => payload.chatId === WRITER.id));
        // Still waiting: the collapsed chat's card stays in the stack.
        expect(stackCard()).not.toBeNull();

        // Answered somewhere else: only the status reaches this window, since nothing here reads the thread now.
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));

        await until(() => stackCard() === null);
    });
});
