import { expect, jest, test } from 'bun:test';
import { act } from 'react';
import type { DesktopBridge, MenuNode, MenuSpec } from '@ruimte/desktop-bridge';
import { registerPromptStack } from '@/canvas/prompt-stack';
import { setHistory } from '@/state/camera-history';
import { useSnoozes } from '@/state/snooze';
import { useChats } from '@adecore/agents-react/state';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { defaultCanvases } from '@/state/canvas';
import { registerCell } from '@/shell/cell-rects';
import { registerFocusedEditor } from '@/shell/panels/focused-editor';
import { registerFocusedLanguage } from '@/language/focused-language';
import type { EditorLanguage } from '@/language/ruimte-editor-language';
import type { Editor } from '@adecore/editor';
import { chatInfoOf } from '../../../testing/chat-info';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace } from '../../../testing/fake-workspace';
import { mount } from '../../../testing/dom';
import { useNativeMenu } from './native-menu';

function Publisher() {
    useNativeMenu();

    return null;
}

function enabled(spec: MenuSpec, id: string): boolean | undefined {
    const find = (nodes: readonly MenuNode[]): boolean | undefined => {
        for (const node of nodes) {
            if (node.kind === 'command' && node.id === id) {
                return node.enabled;
            }

            if (node.kind === 'submenu') {
                const found = find(node.items);

                if (found !== undefined) {
                    return found;
                }
            }
        }

        return undefined;
    };

    return find(spec.menus.flatMap((menu) => menu.items));
}

test('native menu publication follows prompt, camera and snooze changes and stops after disposal', async () => {
    const workspace = await openFakeWorkspace(
        new FakeMachine(),
        {
            views: [
                {
                    kind: 'canvas',
                    id: 'main',
                    name: 'Main',
                    nodes: [{ id: 'chat', kind: 'chat', title: 'Chat', x: 0, y: 0, w: 480, h: 400 }],
                    texts: [],
                    edges: [],
                    layouts: []
                }
            ]
        },
        { activeViewId: 'main', views: {} }
    );
    const page = mount();
    const original = window.ruimteDesktop;
    const sent: MenuSpec[] = [];
    const key = endpointKey(currentEndpointId(), 'chat');
    const endpointId = currentEndpointId();
    let unregister = () => {};
    let mounted = true;
    let releaseEditors = () => {};
    const editorSurface = document.createElement('input');
    const canvas = defaultCanvases.of('main');
    canvas.getState().loadView(
        {
            kind: 'canvas',
            id: 'main',
            name: 'Main',
            nodes: [{ id: 'chat', kind: 'chat', title: 'Chat', x: 0, y: 0, w: 480, h: 400 }],
            texts: [],
            edges: [],
            layouts: []
        },
        null
    );
    window.ruimteDesktop = {
        setMenu: (spec: MenuSpec) => {
            sent.push(spec);
        },
        onMenuCommand: () => () => {}
    } as unknown as DesktopBridge;
    jest.useFakeTimers({ now: 1_000 });

    try {
        await page.render(<Publisher />);
        expect(enabled(sent.at(-1)!, 'prompts')).toBe(false);
        await act(async () => {
            unregister = registerPromptStack('main');
        });
        await act(async () => jest.advanceTimersByTime(99));
        expect(enabled(sent.at(-1)!, 'prompts')).toBe(false);
        await act(async () => jest.advanceTimersByTime(1));
        expect(enabled(sent.at(-1)!, 'prompts')).toBe(true);

        await act(async () => useChats.getState().status(key, chatInfoOf('chat', { status: 'needs-you' })));
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'needs-you-next')).toBe(true);
        await act(async () => useSnoozes.getState().snooze(endpointId, 'chat', 61_000));
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'needs-you-next')).toBe(false);

        // A history mutation can arrive after its canvas event; it must schedule a fresh menu on its own.
        expect(enabled(sent.at(-1)!, 'camera-back')).toBe(false);
        await act(async () => setHistory('main', { back: [{ camera: { x: 200, y: 100, zoom: 1 }, nodeId: null }], forward: [], at: null, burst: null }));
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'camera-back')).toBe(true);

        document.body.append(editorSurface);
        registerCell('main', editorSurface);
        editorSurface.focus();
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'next-change')).toBe(false);
        const offEditor = registerFocusedEditor({ focus() {} } as unknown as Editor, editorSurface);
        releaseEditors = offEditor;
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'next-change')).toBe(true);
        expect(enabled(sent.at(-1)!, 'go-to-definition')).toBe(false);

        const offLanguage = registerFocusedLanguage({ editor: { focus() {} } } as unknown as EditorLanguage, editorSurface);
        releaseEditors = () => {
            offEditor();
            offLanguage();
        };
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'go-to-definition')).toBe(true);
        offEditor();
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'next-change')).toBe(false);
        expect(enabled(sent.at(-1)!, 'go-to-definition')).toBe(true);
        offLanguage();
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'go-to-definition')).toBe(false);
        await act(async () => unregister());
        await act(async () => jest.advanceTimersByTime(100));
        expect(enabled(sent.at(-1)!, 'prompts')).toBe(false);
        await page.unmount();
        mounted = false;
        const count = sent.length;
        unregister = registerPromptStack('main');
        jest.advanceTimersByTime(1_000);
        expect(sent).toHaveLength(count);
    } finally {
        unregister();
        releaseEditors();
        registerCell('main', null);
        editorSurface.remove();
        if (mounted) {
            await page.unmount();
        }

        defaultCanvases.release('main');
        useChats.getState().forget(key);
        useSnoozes.setState({ byKey: {} });
        window.ruimteDesktop = original;
        jest.useRealTimers();
        workspace.close();
    }
});
