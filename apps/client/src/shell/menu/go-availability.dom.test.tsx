import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { MenuNode } from '@ruimte/desktop-bridge';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { isApplePlatform } from '@/desktop/bridge';
import { focusedCanvas } from '@/state/canvas';
import { historyOf, setHistory } from '@/state/camera-history';
import { useDocument } from '@/state/document';
import { registerFocusedEditor } from '@/shell/panels/focused-editor';
import { registerFocusedLanguage } from '@/language/focused-language';
import type { EditorLanguage } from '@/language/ruimte-editor-language';
import { cellElement } from '@/shell/cell-rects';
import type { Editor } from '@adecore/editor';
import { FakeMachine } from '../../../testing/fake-machine';
import { openCanvasPage, menuItem, type CanvasPage } from '../../../testing/canvas-page';
import { clickOn, openSubmenu, until } from '../../../testing/dom';
import { menuContext } from './context';
import { menuModel } from './model';
import { StationMenu } from './StationMenu';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const LEFT: ProjectNode = { id: 'left', kind: 'note', title: 'Left', body: '', x: 0, y: 0, w: 200, h: 100 };
let canvas: CanvasPage;

function offered(id: string): Extract<MenuNode, { kind: 'command' }> {
    const find = (nodes: readonly MenuNode[]): Extract<MenuNode, { kind: 'command' }> | undefined => {
        for (const node of nodes) {
            if (node.kind === 'command' && node.id === id) {
                return node;
            }

            if (node.kind === 'submenu') {
                const nested = find(node.items);

                if (nested) {
                    return nested;
                }
            }
        }

        return undefined;
    };

    const row = find(menuModel(menuContext('station')).menus.flatMap((menu) => menu.items));

    if (!row) {
        throw new Error(`Missing menu command ${id}`);
    }

    return row;
}

beforeEach(async () => {
    canvas = await openCanvasPage(new FakeMachine(), [MAIN], (host) => host.querySelector('[data-canvas-surface]') !== null);
});

afterEach(() => canvas.close());

test('the rendered Go menu disables empty navigation instead of offering no-op clicks', async () => {
    await canvas.page.renderApp(
        <div data-test-go-menu>
            <StationMenu variant="symbol" />
        </div>
    );
    await clickOn(canvas.page.host.querySelector('[data-test-go-menu] button[aria-label="Menu"]'));
    await openSubmenu('Go');

    for (const label of [
        'Previous View',
        'Next View',
        'Previous Camera Position',
        'Next Camera Position',
        'Focus Cell Right',
        'Select Node to the Left',
        'Prompts',
        'Next That Needs You',
        'Go to Definition'
    ]) {
        const item = menuItem(label);
        expect(item).not.toBeNull();
        expect(item?.getAttribute('aria-disabled')).toBe('true');
    }
});

test('node targets include derived cards and disappear during gestures or maximization', async () => {
    await act(async () => {
        focusedCanvas()
            .getState()
            .loadView({ ...MAIN, nodes: [LEFT] }, null);
        focusedCanvas().getState().select([LEFT.id]);
    });

    expect(offered('node-right').enabled).toBe(false);

    await act(async () =>
        focusedCanvas()
            .getState()
            .setDerivedCard('card', { owner: LEFT.id, rect: { x: 300, y: 0, w: 200, h: 100 }, resize: null })
    );
    expect(offered('node-right').enabled).toBe(true);
    expect(offered('node-left').enabled).toBe(false);

    await act(async () => focusedCanvas().getState().setGesturing(true));
    expect(offered('node-right').enabled).toBe(false);
    await act(async () => focusedCanvas().getState().setGesturing(false));
    await act(async () => focusedCanvas().setState({ hidden: new Set([LEFT.id]) }));
    expect(offered('node-right').enabled).toBe(false);
    await act(async () => focusedCanvas().setState({ hidden: new Set() }));
    await act(async () => focusedCanvas().getState().toggleMaximizedNode(LEFT.id));
    expect(offered('node-right').enabled).toBe(false);
});

test('camera availability skips deleted stops without mutating history and follows a real step', async () => {
    const camera = { x: 200, y: 100, zoom: 1 };
    const missing = { back: [{ camera, nodeId: 'gone' }], forward: [], at: null, burst: null };
    setHistory(MAIN.id, missing);
    expect(offered('camera-back').enabled).toBe(false);
    expect(historyOf(MAIN.id)).toBe(missing);
    setHistory(MAIN.id, { ...missing, back: [{ camera, nodeId: null }] });
    expect(offered('camera-back').enabled).toBe(true);
    expect(offered('camera-forward').enabled).toBe(false);

    await act(async () => {
        focusedCanvas().getState().stepCamera(-1);
    });
    expect(offered('camera-back').enabled).toBe(false);
    expect(offered('camera-forward').enabled).toBe(true);
});

test('view and cell navigation follow the actual focused grid and a loose view has no sidebar successor', async () => {
    const other = { ...MAIN, id: 'other', name: 'Other' };

    await act(async () =>
        useDocument.setState({
            views: [MAIN, other],
            layout: {
                columns: [
                    { size: 0.5, cells: [{ viewId: MAIN.id, size: 1 }] },
                    { size: 0.5, cells: [{ viewId: other.id, size: 1 }] }
                ],
                focus: { column: 0, cell: 0 }
            }
        })
    );

    expect(offered('view-next').enabled).toBe(true);
    expect(offered('focus-left').enabled).toBe(false);
    expect(offered('focus-right').enabled).toBe(true);
    expect(offered('focus-down').enabled).toBe(false);

    await act(async () => useDocument.getState().focusTowards('right'));
    expect(offered('focus-left').enabled).toBe(true);
    expect(offered('focus-right').enabled).toBe(false);

    await act(async () => useDocument.getState().showLoose('file:/tmp/loose.txt'));
    expect(offered('view-next').enabled).toBe(false);
    expect(offered('view-previous').enabled).toBe(false);
});

test('a menu read finds the active cell editor without stealing keyboard focus', async () => {
    const surface = document.createElement('div');
    const input = document.createElement('input');
    const cell = cellElement(MAIN.id)!;
    surface.append(input);
    cell.append(surface);
    let focused = 0;
    const unregister = registerFocusedEditor(
        {
            focus: () => {
                focused++;
            }
        } as unknown as Editor,
        surface
    );
    const unregisterLanguage = registerFocusedLanguage(
        {
            editor: {
                focus: () => {
                    focused++;
                }
            }
        } as unknown as EditorLanguage,
        surface
    );

    try {
        input.focus();
        const menuButton = document.createElement('button');
        document.body.append(menuButton);
        menuButton.focus();
        expect(offered('next-change').enabled).toBe(true);
        expect(offered('go-to-definition').enabled).toBe(true);
        expect(document.activeElement).toBe(menuButton);
        expect(focused).toBe(0);
        unregister();
        unregisterLanguage();
        expect(offered('next-change').enabled).toBe(false);
        expect(offered('go-to-definition').enabled).toBe(false);
        menuButton.remove();
    } finally {
        unregister();
        unregisterLanguage();
        surface.remove();
    }
});

test('empty view, focus and camera keys stay free while node keys prevent browser history navigation', async () => {
    const surface = canvas.page.host.querySelector<HTMLElement>('[data-canvas-surface]')!;
    const mod = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };

    for (const init of [
        { key: '[', code: 'BracketLeft', shiftKey: true, ...mod },
        { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, ...mod },
        { key: '[', code: 'BracketLeft', altKey: true, ...mod }
    ]) {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        await act(async () => {
            surface.dispatchEvent(event);
        });
        expect(event.defaultPrevented).toBe(false);
    }

    const noTarget = new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    await act(async () => {
        surface.dispatchEvent(noTarget);
    });
    expect(noTarget.defaultPrevented).toBe(true);
    expect(focusedCanvas().getState().selection).toEqual([]);

    await act(async () =>
        focusedCanvas()
            .getState()
            .loadView({ ...MAIN, nodes: [LEFT, { ...LEFT, id: 'right', x: 400 }] }, null)
    );
    await act(async () => focusedCanvas().getState().select([LEFT.id]));
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    await act(async () => {
        surface.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await until(() => focusedCanvas().getState().selection[0] === 'right');

    const targetCamera = { x: 777, y: 200, zoom: 1 };
    setHistory('main', { back: [{ camera: targetCamera, nodeId: null }], forward: [], at: null, burst: null });
    const back = new KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', altKey: true, ...mod, bubbles: true, cancelable: true });
    await act(async () => {
        surface.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    expect(focusedCanvas().getState().camera).toEqual(targetCamera);
});
