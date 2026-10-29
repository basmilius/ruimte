import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatApprovalItem, ChatInfo, ChatQuestionItem, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import { usePromptFold, useSnoozedList } from '@/canvas/prompt-stack';
import { isApplePlatform } from '@/desktop/bridge';
import { useSnoozes } from '@/state/snooze';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { clickOn, pressKey, until } from '../../testing/dom';
import { menuItem, openCanvasPage, type CanvasPage } from '../../testing/canvas-page';

const WRITER: ProjectNode = { id: 'writer', kind: 'chat', title: 'Writer', x: 40, y: 80, w: 480, h: 520 };
const TEAM: ProjectNode = { id: 'team', kind: 'group', title: 'Team', x: 0, y: 0, w: 600, h: 700, memberIds: [WRITER.id] };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [TEAM, WRITER], texts: [], edges: [], layouts: [] };

const SAMPLE = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0] as ChatApprovalItem;
const WRITE: ChatApprovalItem = { ...SAMPLE, id: 'approval-write', requestId: 'write', decision: 'pending', createdAt: 100 };
const QUESTION = PROMPT_SAMPLES.find((sample) => sample.label === 'Question · Single choice')!.items[0] as ChatQuestionItem;
const ASK: ChatQuestionItem = { ...QUESTION, id: 'question-ask', requestId: 'ask', createdAt: 50 };

const WRITE_REQUEST = { requestId: WRITE.requestId, itemId: WRITE.id, kind: 'approval' as const, createdAt: WRITE.createdAt };
const ASK_REQUEST = { requestId: ASK.requestId, itemId: ASK.id, kind: 'question' as const, createdAt: ASK.createdAt };
const WAITING: ChatInfo = chatInfoOf(WRITER.id, { status: 'needs-you', requests: [WRITE_REQUEST, ASK_REQUEST] });

const MOD = isApplePlatform() ? 'metaKey' : 'ctrlKey';

let machine: FakeMachine;
let canvas: CanvasPage;

function stackCard(): Element | null {
    return document.querySelector(`[data-prompt-stack="${MAIN.id}"] .prompt-card`);
}

function stack(): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-prompt-stack="${MAIN.id}"]`)!;
}

function stackButton(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-prompt-stack="${MAIN.id}"] button[aria-label="${label}"]`);
}

/* The count at the edge of the stack that opens the snoozed list. */
function snoozedButton(): HTMLElement | null {
    return ([...stack().querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.includes('snoozed')) ?? null;
}

async function snoozeFromRow(): Promise<void> {
    await clickOn(stackButton('Snooze'));
    await until(() => menuItem('10 minutes') !== null);
    await clickOn(menuItem('10 minutes'));
    await until(() => stackCard() === null);
}

async function status(info: ChatInfo): Promise<void> {
    await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info }));
}

function collapseButton(): HTMLElement | null {
    return canvas.page.host.querySelector(`[data-node-id="${TEAM.id}"] button[aria-label="Collapse"]`);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('chat.attach', ({ chatId }) => ({
        info: chatId === WRITER.id ? WAITING : chatInfoOf(chatId),
        items: chatId === WRITER.id ? [ASK, WRITE] : []
    }));
    canvas = await openCanvasPage(machine, [MAIN], () => stackCard() !== null);
});

afterEach(async () => {
    await canvas.close();
    usePromptFold.setState({ folded: new Set() });
    useSnoozes.setState({ byKey: {} });
    useSnoozedList.setState({ openFor: null });
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

    test('folds into a bar that says who asks, how many wait and what the front one asks, and opens again', async () => {
        await clickOn(stackButton('Fold prompt'));

        expect(stackCard()).toBeNull();
        expect(stack().textContent).toContain('Writer');
        expect(stack().textContent).toContain('2 waiting');
        expect(stack().textContent).toContain('Which endpoints should share the backoff?');
        expect(document.activeElement).toBe(stackButton('Open prompt'));

        await clickOn(stackButton('Open prompt'));

        expect(stackCard()).not.toBeNull();
        expect(document.activeElement).toBe(stackButton('Fold prompt'));
    });

    test('stays folded while prompts come and go, and arrives open after the stack emptied', async () => {
        await clickOn(stackButton('Fold prompt'));
        await status(chatInfoOf(WRITER.id, { status: 'needs-you', requests: [ASK_REQUEST] }));

        expect(stackCard()).toBeNull();
        expect(stack().textContent).not.toContain('waiting');

        await status(chatInfoOf(WRITER.id));
        await until(() => stackButton('Open prompt') === null);
        await status(WAITING);

        await until(() => stackCard() !== null);
    });

    test('opens on the prompts shortcut and puts the keyboard on the card', async () => {
        await clickOn(stackButton('Fold prompt'));
        await pressKey(document.body, 'p', { [MOD]: true, shiftKey: true });

        expect(stackCard()).not.toBeNull();
        expect(stackCard()!.contains(document.activeElement)).toBe(true);
    });

    test('snoozing from the row snoozes the node that asks, and leaves the way back in its place', async () => {
        await snoozeFromRow();

        expect(machine.requests('snooze.set').map((payload) => payload.nodeId)).toEqual([WRITER.id]);
        expect(snoozedButton()).not.toBeNull();
        expect(snoozedButton()!.textContent).toContain('1 snoozed');
    });

    test('Unsnooze in the list ends the snooze and brings the card back', async () => {
        await snoozeFromRow();
        await clickOn(snoozedButton());
        await until(() => document.querySelector('[role="menuitem"][aria-label="Unsnooze Writer"]') !== null);
        await clickOn(document.querySelector('[role="menuitem"][aria-label="Unsnooze Writer"]'));

        expect(machine.requests('snooze.clear')).toEqual([{ nodeId: WRITER.id }]);
        await until(() => stackCard() !== null);
        expect(snoozedButton()).toBeNull();
    });

    test('a snooze the machine sets or ends moves the card out of the stack and back', async () => {
        await act(async () => machine.emit('snooze.changed', { snoozes: [{ projectId: 'project-atlas', nodeId: WRITER.id, until: 9_999_999_999_999 }] }));
        await until(() => stackCard() === null);

        await act(async () => machine.emit('snooze.changed', { snoozes: [] }));
        await until(() => stackCard() !== null);
    });

    test('opens when Next That Needs You goes to the node that asks', async () => {
        await clickOn(stackButton('Fold prompt'));
        await pressKey(document.body, 'p', { [MOD]: true, altKey: true });

        await until(() => stackCard() !== null);
    });
});
