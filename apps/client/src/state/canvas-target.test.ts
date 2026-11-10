import { describe, expect, test } from 'bun:test';
import { emptyCanvasView, type ProjectView, type SplitLayout } from '@ruimte/contracts';
import { canvasInReach } from './canvas-target.ts';

const views: ProjectView[] = [
    emptyCanvasView('main', 'Main'),
    emptyCanvasView('release', 'Release'),
    emptyCanvasView('sketches', 'Sketches'),
    { kind: 'terminal', id: 'shell', name: 'Shell', node: {} }
];

function layout(columns: string[][], focus = { column: 0, cell: 0 }): SplitLayout {
    return {
        columns: columns.map((cells) => ({ size: 1 / columns.length, cells: cells.map((viewId) => ({ viewId, size: 1 / cells.length })) })),
        focus
    };
}

describe('canvasInReach', () => {
    test('the canvas in the focused cell wins', () => {
        expect(canvasInReach({ views, layout: layout([['release'], ['sketches']], { column: 1, cell: 0 }), lastCanvasViewId: 'main' })?.id).toBe('sketches');
    });

    test('a canvas in another cell wins over the one up last that is off screen', () => {
        expect(canvasInReach({ views, layout: layout([['shell'], ['release']]), lastCanvasViewId: 'main' })?.id).toBe('release');
    });

    test('of several canvases on screen beside the focused cell, the one up last wins', () => {
        expect(canvasInReach({ views, layout: layout([['shell'], ['release'], ['sketches']]), lastCanvasViewId: 'sketches' })?.id).toBe('sketches');
        expect(canvasInReach({ views, layout: layout([['shell'], ['release'], ['sketches']]), lastCanvasViewId: 'main' })?.id).toBe('release');
    });

    test('a canvas in a background tab is not on screen', () => {
        const tabbed: SplitLayout = {
            columns: [
                { size: 0.5, cells: [{ viewId: 'shell', size: 1 }] },
                { size: 0.5, cells: [{ viewId: 'shell-2', tabs: ['release', 'shell-2'], size: 1 }] }
            ],
            focus: { column: 0, cell: 0 }
        };
        expect(canvasInReach({ views, layout: tabbed, lastCanvasViewId: 'main' })?.id).toBe('main');
    });

    test('with no canvas on screen the one up last wins, else the first there is', () => {
        expect(canvasInReach({ views, layout: layout([['shell']]), lastCanvasViewId: 'release' })?.id).toBe('release');
        expect(canvasInReach({ views, layout: null, lastCanvasViewId: null })?.id).toBe('main');
    });

    test('a project without a canvas has none', () => {
        expect(canvasInReach({ views: views.filter((view) => view.kind !== 'canvas'), layout: layout([['shell']]), lastCanvasViewId: null })).toBeNull();
    });
});
