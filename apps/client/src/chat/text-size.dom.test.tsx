import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { isApplePlatform } from '@/desktop/bridge';
import { focusedCanvas } from '@/state/canvas';
import { useChatTextSizes } from '@/state/chat-text-size';
import { useDocument } from '@/state/document';
import { useSettings } from '@/state/settings';
import { startSessionLifecycle } from '@/terminal/lifecycle';
import { runMenuCommand } from '@/shell/menu/actions';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { claudeProvider } from '../../testing/fake-provider';

const REVIEW: ProjectNode = { id: 'text-review', kind: 'chat', title: 'Review', x: 0, y: 0, w: 480, h: 520 };
const OTHER: ProjectNode = { ...REVIEW, id: 'text-other', title: 'Other', x: 520 };
const TERMINAL: ProjectNode = { ...REVIEW, kind: 'terminal', id: 'text-terminal', title: 'Terminal', x: 1040 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [REVIEW, OTHER, TERMINAL], texts: [], edges: [], layouts: [] };
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let stopLifecycle: () => void;

function reading(id: string): HTMLElement | null {
    return (
        page.host.querySelector(`[data-node-id="${id}"] [data-chat-text-size]`) ??
        page.host.querySelector(`[data-split-cell][data-view-id="${id}"] [data-chat-text-size]`)
    );
}

async function key(value: string, target: HTMLElement = document.body, shiftKey = false): Promise<void> {
    const apple = isApplePlatform();
    await pressKey(target, value, { metaKey: apple, ctrlKey: !apple, shiftKey });
}

async function focus(id: string): Promise<void> {
    await act(async () => focusedCanvas().getState().activateNode(id));
}

beforeEach(async () => {
    useChatTextSizes.setState({ byKey: {} });
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [claudeProvider({ chat: true, terminal: true })] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [] }));
    machine.answer('fs.read', () => ({ kind: 'text', text: 'const answer = 42;\n', encoding: 'utf-8', size: 19, mtime: 1, language: 'typescript' }) as never);
    workspace = await openFakeWorkspace(
        machine,
        {
            views: [
                MAIN,
                { kind: 'chat', id: 'text-standalone', name: 'Standalone', node: {} },
                { kind: 'file', id: 'text-file', name: 'answer.ts', path: 'src/answer.ts' }
            ]
        },
        { activeViewId: MAIN.id, views: {} }
    );
    page = mount();
    await page.renderApp();
    await until(() => reading(REVIEW.id) !== null && reading(OTHER.id) !== null);
    stopLifecycle = startSessionLifecycle();
});

afterEach(async () => {
    stopLifecycle();
    await page.unmount();
    workspace.close();
    useChatTextSizes.setState({ byKey: {} });
});

describe('focused chat text', () => {
    test('modifier plus, shifted plus and equals use bounded presets, and reset leaves the camera and neighbor alone', async () => {
        await focus(REVIEW.id);
        const camera = focusedCanvas().getState().camera;
        const codeZoom = useSettings.getState().codeZoom;
        await key('+');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('2');
        await key('+', document.body, true);
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('3');
        await key('=');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('3');
        await key('-');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('2');
        await key('0');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('1');
        expect(reading(OTHER.id)!.dataset.chatTextSize).toBe('1');
        expect(focusedCanvas().getState().camera).toEqual(camera);
        expect(useSettings.getState().codeZoom).toBe(codeZoom);
        expect(machine.requests('chat.send')).toEqual([]);
    });

    test('a composer keeps keyboard focus while its chat text changes', async () => {
        await focus(REVIEW.id);
        await until(() => reading(REVIEW.id)!.querySelector('.cm-content') !== null);
        const composer = reading(REVIEW.id)!.querySelector<HTMLElement>('.cm-content')!;
        await act(async () => composer.focus());
        await key('=', composer);
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('2');
        expect(document.activeElement === composer).toBe(true);
        expect(machine.requests('chat.send')).toEqual([]);
    });

    test('a selected chat alone is skipped, but a maximized chat on its frame is a target', async () => {
        await act(async () => {
            focusedCanvas().getState().select([REVIEW.id]);
            focusedCanvas().getState().setBodyFocus(null);
        });
        const camera = focusedCanvas().getState().camera;
        await key('=');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('1');
        expect(focusedCanvas().getState().camera).toEqual(camera);
        await act(async () => {
            focusedCanvas().getState().toggleMaximizedNode(REVIEW.id);
            focusedCanvas().getState().setBodyFocus(null);
        });
        await key('=');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('2');
        await key('0');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('1');
    });

    test('a dialog and a terminal keep their keyboard ownership', async () => {
        await focus(REVIEW.id);
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.className = 'dialog-popup';
        const input = document.createElement('input');
        dialog.append(input);
        document.body.append(dialog);

        try {
            await key('=', input);
            expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('1');
        } finally {
            dialog.remove();
        }

        await focus(TERMINAL.id);
        await key('=');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('1');
    });

    test('the menu changes a standalone chat and returning to its view retains its preset', async () => {
        await act(async () => useDocument.getState().setActiveView('text-standalone'));
        await until(() => reading('text-standalone') !== null);
        await act(async () => runMenuCommand('chat-text-larger'));
        await until(() => reading('text-standalone')!.dataset.chatTextSize === '2');
        await act(async () => useDocument.getState().setActiveView(MAIN.id));
        await act(async () => useDocument.getState().setActiveView('text-standalone'));
        await until(() => reading('text-standalone') !== null);
        expect(reading('text-standalone')!.dataset.chatTextSize).toBe('2');
        await key('0');
        expect(reading('text-standalone')!.dataset.chatTextSize).toBe('1');
    });

    test('a focused file editor beside a chat keeps its own text commands', async () => {
        await focus(REVIEW.id);
        await act(async () => useDocument.getState().splitFocused('right', 'text-file'));
        await until(() => page.host.querySelector('textarea[aria-label^="Code file"]') !== null);
        const editor = page.host.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Code file"]')!;
        await act(async () => editor.focus());
        const codeZoom = useSettings.getState().codeZoom;
        await key('=', editor);
        await key('-', editor);
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('1');
        expect(useSettings.getState().codeZoom).toBe(codeZoom);
        expect(document.activeElement).toBe(editor);
    });

    test('deleting a chat discards its reading preference through the existing lifecycle', async () => {
        await focus(REVIEW.id);
        await key('=');
        expect(reading(REVIEW.id)!.dataset.chatTextSize).toBe('2');
        await act(async () => focusedCanvas().getState().deleteSelected());
        await until(() => reading(REVIEW.id) === null);
        expect(Object.keys(useChatTextSizes.getState().byKey)).toEqual([]);
    });
});
