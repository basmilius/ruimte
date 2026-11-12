import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { emptyCanvas } from '../../testing/project-fixtures';

let canvas: CanvasPage;
let before: {
    window: { width: number; height: number };
    ui: Pick<ReturnType<typeof useUi.getState>, 'panel' | 'panelWidth' | 'panelsRestoring'>;
};

function panel(): HTMLElement | null {
    return canvas.page.host.querySelector<HTMLElement>('[data-surface="panel"]');
}

/* The width the panel's contents are drawn at, without the gap beside it. */
function shownWidth(): number {
    return Number.parseInt(panel()?.querySelector<HTMLElement>(':scope > div')?.style.width ?? '', 10);
}

async function resizeWindow(width: number, height = 800): Promise<void> {
    await act(async () => {
        (window as unknown as { happyDOM: { setViewport(viewport: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height });
        window.dispatchEvent(new Event('resize'));
    });
}

beforeEach(async () => {
    const { panel: shown, panelWidth, panelsRestoring } = useUi.getState();
    before = { window: { width: window.innerWidth, height: window.innerHeight }, ui: { panel: shown, panelWidth, panelsRestoring } };

    canvas = await openCanvasPage(new FakeMachine(), [emptyCanvas()], (host) => host.querySelector('#app-sidebar') !== null);
    await resizeWindow(1280);
    await act(async () => useUi.setState({ panel: { open: true, kind: 'processes' }, panelWidth: 800 }));
    await until(() => panel() !== null);
});

afterEach(async () => {
    await canvas.close();
    await resizeWindow(before.window.width, before.window.height);
    useUi.setState(before.ui);
});

describe('the width of the side panel', () => {
    test('shrinks with a window made narrower, and is back at the dragged width once the window is wide again', async () => {
        expect(shownWidth()).toBe(800);

        await resizeWindow(900);

        expect(shownWidth()).toBe(540);
        expect(useUi.getState().panelWidth).toBe(800);

        await resizeWindow(1280);

        expect(shownWidth()).toBe(800);
    });
});
