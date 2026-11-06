import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isApplePlatform } from '@adecore/ui';
import type { ChatItem } from '@ruimte/contracts';
import { act } from 'react';
import { textDrafts } from '@/state/text-drafts';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { forgetInlineSessions } from './inline-edit-session';

const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
const VIEW = { kind: 'file', id: 'greet-view', name: 'greet.ts', path: 'greet.ts' };
const TEXT = 'export function greet(name) {\n    return "hi " + name;\n}\n';
const CHAT_ID = 'inline-chat';
const TURN_ID = 'turn-1';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

function question(): HTMLInputElement | null {
    return page.host.querySelector('input[aria-label="Describe the change…"]');
}

/* By the words it starts with, since a button may carry its shortcut after them. */
function button(label: string): HTMLButtonElement | null {
    return [...page.host.querySelectorAll('button')].find((element) => element.textContent?.trim().startsWith(label)) ?? null;
}

async function openEditor(): Promise<void> {
    await page.renderApp();
    await until(() => input() !== null);
    await act(async () => input()!.focus());
    await until(() => machine.requests('language.document.open').length > 0);
}

/* Selects the whole file and asks for an inline edit of it, the way a person does with the keyboard. */
async function askAboutEverything(): Promise<void> {
    await openEditor();
    await pressKey(input()!, 'a', MOD);
    await pressKey(input()!, 'i', MOD);
    await until(() => question() !== null);
}

async function typeQuestion(text: string): Promise<void> {
    await act(async () => {
        const field = question()!;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(field, text);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function emitItem(item: ChatItem, seq: number): Promise<void> {
    return act(async () => machine.emit('chat.event', { chatId: CHAT_ID, event: { type: 'item', item }, seq }));
}

/* The agent answers with a replacement for the selected lines, and its turn ends. */
async function answer(replacement: string): Promise<void> {
    await emitItem(
        {
            id: 'reply',
            kind: 'assistant',
            turnId: TURN_ID,
            createdAt: 2,
            text: `\`\`\`replacement\n${replacement}\n\`\`\`\nRenamed the greeting.`,
            streaming: false
        } as ChatItem,
        2
    );
    await emitItem({ id: TURN_ID, kind: 'turn', turnId: TURN_ID, createdAt: 1, state: 'done', endedAt: 3, costUsd: 0 } as ChatItem, 3);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [claudeProvider()] }) as never);
    machine.answer('fs.read', () => ({ kind: 'text', text: TEXT, encoding: 'utf-8', size: TEXT.length, mtime: 1, language: 'typescript' }) as never);
    machine.answer('language.document.open', () => ({ version: 1, servers: ['typescript'], providers: {} }));
    machine.answer('project.newInlineChat', () => ({ chatId: CHAT_ID, viewId: CHAT_ID }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('chat.send', () => {
        const item = { id: TURN_ID, kind: 'turn', turnId: TURN_ID, createdAt: 1, state: 'running', endedAt: null, costUsd: 0 } as ChatItem;
        machine.emit('chat.event', { chatId: CHAT_ID, event: { type: 'item', item }, seq: 1 });

        return { turnId: TURN_ID } as never;
    });
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    forgetInlineSessions();
    // An unsaved draft outlives the window that drew it, and the next test opens the same file.
    textDrafts.discard('fake-machine', '/work/atlas/greet.ts');
});

describe('an inline edit', () => {
    test('asks about the selected lines and sends nothing until a person runs it', async () => {
        await askAboutEverything();

        expect(page.host.querySelector('[aria-label="Selected lines"]')?.textContent).toMatch(/^greet\.ts:1-\d$/);

        await pressKey(question()!, 'Escape');

        expect(question()).toBeNull();
        expect(machine.requests('project.newInlineChat')).toEqual([]);
        expect(machine.requests('chat.send')).toEqual([]);
    });

    test('runs the question in a hidden chat and applies the proposal to the lines only on Apply', async () => {
        await askAboutEverything();
        await typeQuestion('greet with hello');
        await pressKey(question()!, 'Enter');
        await until(() => machine.requests('chat.send').length > 0);

        expect(machine.requests('project.newInlineChat')).toEqual([{ projectId: 'project-atlas', path: 'greet.ts', provider: 'claude' }]);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: CHAT_ID, mentions: ['greet.ts'] });
        expect(machine.requests('chat.send')[0]?.text).toContain('greet with hello');
        expect(machine.requests('chat.send')[0]?.text).toContain('return "hi " + name;');

        await answer('export function greet(name) {\n    return "hello " + name;\n}');
        await until(() => button('Apply') !== null);

        expect(input()!.value).toBe(TEXT);

        await clickOn(button('Apply'));
        await until(() => machine.requests('project.removeInlineChat').length > 0);

        expect(input()!.value).toBe('export function greet(name) {\n    return "hello " + name;\n}\n');
        expect(machine.requests('project.removeInlineChat')).toEqual([{ projectId: 'project-atlas', viewId: CHAT_ID }]);
    });

    test('Discard leaves the file as it was and takes the chat away', async () => {
        await askAboutEverything();
        await typeQuestion('greet with hello');
        await pressKey(question()!, 'Enter');
        await until(() => machine.requests('chat.send').length > 0);
        await answer('export function greet(name) {\n    return "hello " + name;\n}');
        await until(() => button('Discard') !== null);

        await clickOn(button('Discard'));
        await until(() => machine.requests('project.removeInlineChat').length > 0);

        expect(input()!.value).toBe(TEXT);
        expect(button('Apply')).toBeNull();
    });
});
