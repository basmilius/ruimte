import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { EditorView } from '@codemirror/view';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { canvasOfNode } from '@/state/canvas';
import { currentEndpointId } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { screenOf } from '@/terminal/registry';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { chatInfoOf } from '../../testing/chat-info';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';

const CHAT: ProjectNode = { id: 'held-chat', kind: 'chat', title: 'Read later', provider: 'claude', x: 0, y: 0, w: 480, h: 520 };
const SHELL: ProjectNode = { id: 'held-shell', kind: 'terminal', title: 'Keep running', x: 600, y: 0, w: 480, h: 520 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [CHAT, SHELL], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;
const dimensions = ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight'] as const;
let dimensionDescriptors: Array<PropertyDescriptor | undefined>;

function dimension(element: HTMLElement, name: (typeof dimensions)[number]): number {
    if (!element.closest('[data-node-id]')) {
        return 0;
    }

    if (name.endsWith('Width')) {
        return 480;
    }

    return element.hasAttribute('data-file-cwd') || element.classList.contains('chat-scroll') ? 400 : 80;
}

function frame(id: string): HTMLElement {
    return canvas.page.host.querySelector('[data-node-id="' + id + '"]')!;
}

function shown(selector: string): boolean {
    const element = frame(CHAT.id).querySelector<HTMLElement>(selector);

    if (!element) {
        return false;
    }

    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if (node.style.display === 'none') {
            return false;
        }
    }

    return true;
}

function composer(): EditorView {
    return EditorView.findFromDOM(frame(CHAT.id).querySelector('.cm-content') as HTMLElement)!;
}

async function camera(zoom: number, x = 0): Promise<void> {
    await act(async () => canvasOfNode(CHAT.id)!.getState().setCamera({ x, y: 0, zoom }));
}

async function advance(ms: number): Promise<void> {
    await act(async () => jest.advanceTimersByTime(ms));
}

beforeEach(async () => {
    dimensionDescriptors = dimensions.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));

    for (const name of dimensions) {
        Object.defineProperty(HTMLElement.prototype, name, {
            get(this: HTMLElement) {
                return dimension(this, name);
            },
            configurable: true
        });
    }

    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [fakeProvider('claude', 'Claude Code')] }));
    machine.answer(
        'chat.attach',
        ({ chatId }) =>
            ({
                info: chatInfoOf(chatId, { usage: { turns: 1, contextTokens: 0, contextWindow: 200000, costUsd: 0 } }),
                items: [{ id: 'answer', kind: 'assistant', createdAt: 1, turnId: null, text: 'Original answer', streaming: false }],
                seq: 0
            }) as never
    );
    machine.answer('session.attach', () => ({ screen: 'First screen', cols: 80, rows: 24, exited: false }));
    useSettings.setState({ canvasRenderDistance: 'standard' });
    canvas = await openCanvasPage(machine, [MAIN], CHAT.id);
    await act(async () => {
        const state = canvasOfNode(CHAT.id)!.getState();
        state.setViewport({ w: 1280, h: 800 });
        state.setCamera({ x: 0, y: 0, zoom: 1 });
        state.setBodyFocus(null);
    });
    await until(
        () =>
            shown('.chat-scroll') &&
            frame(CHAT.id).textContent?.includes('Original answer') === true &&
            frame(CHAT.id).querySelector('.cm-content') !== null &&
            frame(SHELL.id).querySelector('textarea') !== null &&
            screenOf(currentEndpointId(), SHELL.id)?.join('\n').includes('First screen') === true
    );
    jest.useFakeTimers();
});

afterEach(async () => {
    try {
        await canvas.close();
    } finally {
        jest.useRealTimers();
    }
    useSettings.setState({ canvasRenderDistance: 'standard' });

    dimensions.forEach((name, index) => {
        const descriptor = dimensionDescriptors[index];

        if (descriptor) {
            Object.defineProperty(HTMLElement.prototype, name, descriptor);
        } else {
            Reflect.deleteProperty(HTMLElement.prototype, name);
        }
    });
});

test('a small chat pauses its surface after the grace period without detaching and restores the latest answer and draft', async () => {
    await act(async () => composer().dispatch(composer().state.replaceSelection('Unsent draft'), { userEvent: 'input.type' }));
    await camera(0.3);
    await advance(9900);
    expect(shown('.chat-scroll')).toBe(true);
    await advance(100);
    expect(shown('.chat-scroll')).toBe(false);
    expect(machine.requests('chat.detach')).toHaveLength(0);
    await act(async () => machine.emit('chat.event', { chatId: CHAT.id, seq: 1, event: { type: 'delta', itemId: 'answer', text: ' with new text' } }));
    await camera(1);
    await advance(1000);
    expect(shown('.chat-scroll')).toBe(true);
    expect(frame(CHAT.id).textContent).toContain('Original answer with new text');
    expect(composer().state.doc.toString()).toBe('Unsent draft');
    expect(machine.requests('chat.attach')).toHaveLength(1);
});

test('a quick zoom cancels suspension and active or maximized chats remain live', async () => {
    await camera(0.3);
    await advance(9900);
    await camera(1);
    await advance(200);
    expect(shown('.chat-scroll')).toBe(true);
    await act(async () => canvasOfNode(CHAT.id)!.getState().setBodyFocus(CHAT.id));
    await camera(0.3, -10000);
    await advance(11000);
    expect(shown('.chat-scroll')).toBe(true);
    await act(async () => {
        const state = canvasOfNode(CHAT.id)!.getState();
        state.setBodyFocus(null);
        state.toggleMaximizedNode(CHAT.id);
    });
    await advance(11000);
    expect(shown('.chat-scroll')).toBe(true);
});

test('a terminal below render distance detaches its renderer, keeps its session, and takes a fresh screen on return', async () => {
    const opened = machine.requests('session.attach').length;
    await camera(0.3);
    await advance(10000);
    expect(frame(SHELL.id).querySelector('textarea') === null).toBe(true);
    expect(machine.requests('session.detach').some((payload) => payload.sessionId === SHELL.id)).toBe(true);
    expect(frame(SHELL.id).textContent).toContain('First screen');
    const resized = machine.requests('session.resize').length;
    await advance(10000);
    expect(machine.requests('session.resize')).toHaveLength(resized);
    expect(machine.requests('session.kill')).toHaveLength(0);
    machine.answer('session.attach', () => ({ screen: 'Fresh screen', cols: 80, rows: 24, exited: false }));
    await camera(1);
    await advance(1000);
    expect(frame(SHELL.id).querySelector('textarea') !== null).toBe(true);
    expect(screenOf(currentEndpointId(), SHELL.id)?.join('\n')).toContain('Fresh screen');
    expect(machine.requests('session.attach').length).toBeGreaterThan(opened);
});

test('an offscreen chat suspends after its hold and returns without another attach', async () => {
    await camera(1, -10000);
    await advance(10000);
    expect(shown('.chat-scroll')).toBe(false);
    expect(machine.requests('chat.detach')).toHaveLength(0);
    await camera(1);
    await advance(1000);
    expect(shown('.chat-scroll')).toBe(true);
    expect(machine.requests('chat.attach')).toHaveLength(1);
});

test('an active terminal outside the viewport retains its renderer and attachment', async () => {
    await act(async () => canvasOfNode(SHELL.id)!.getState().setBodyFocus(SHELL.id));
    await camera(0.3, -10000);
    await advance(11000);
    expect(frame(SHELL.id).querySelector('textarea') !== null).toBe(true);
    expect(machine.requests('session.detach').some((payload) => payload.sessionId === SHELL.id)).toBe(false);
});

test('chat and terminal follow the selected render distance instead of a fixed threshold', async () => {
    await act(async () => useSettings.setState({ canvasRenderDistance: 'far' }));
    await camera(0.3);
    await advance(11000);
    expect(shown('.chat-scroll')).toBe(true);
    expect(frame(SHELL.id).querySelector('textarea') !== null).toBe(true);
    await act(async () => useSettings.setState({ canvasRenderDistance: 'standard' }));
    await advance(10000);
    expect(shown('.chat-scroll')).toBe(false);
    await act(async () => useSettings.setState({ canvasRenderDistance: 'unlimited' }));
    await camera(0.1);
    await advance(11000);
    expect(shown('.chat-scroll')).toBe(true);
    expect(frame(SHELL.id).querySelector('textarea') !== null).toBe(true);
});
