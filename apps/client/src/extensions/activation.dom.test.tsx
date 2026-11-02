import { afterEach, describe, expect, jest, test } from 'bun:test';
import { wantsLoading, watchActivation } from '@/extensions/activation';
import { focusedCanvas } from '@/state/canvas';
import type { CanvasNode } from '@/state/canvas-model';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

let stop: (() => void) | null = null;

function note(id: string): CanvasNode {
    return { id, kind: 'note', title: id, x: 0, y: 0, w: 100, h: 100 } as CanvasNode;
}

afterEach(() => {
    stop?.();
    stop = null;
    jest.useRealTimers();
    focusedCanvas().setState({ nodes: {} });
    useFiles.setState({ tabs: [] });
    useDocument.setState({ views: [], activeViewId: null });
});

describe('what loads an extension', () => {
    test("loads for a view of the extension's type, read from the view as the project file keeps it", () => {
        const raw = { kind: 'extension', id: 'view-1', name: 'Board', extension: 'acme.board', type: 'board' };

        useDocument.setState({ views: [{ kind: 'unknown', id: 'view-1', name: 'Board', raw }], activeViewId: 'view-1' });

        expect(wantsLoading(['view:board'])).toBe(true);
        expect(wantsLoading(['view:list'])).toBe(false);
    });
});

describe('watching what loads an extension', () => {
    test('asks once for a burst, and not for a change inside a tab', () => {
        jest.useFakeTimers();

        let checks = 0;

        stop = watchActivation(() => {
            checks += 1;
        });
        focusedCanvas().setState({ nodes: { one: note('one') } });
        focusedCanvas().setState({ nodes: { one: note('one'), two: note('two') } });
        useFiles.setState({ tabs: [{ key: '/work/a.csv', path: '/work/a.csv', pinned: false } as never] });
        jest.advanceTimersByTime(100);

        expect(checks).toBe(1);

        useFiles.setState({ tabs: [{ key: '/work/a.csv', path: '/work/a.csv', pinned: true } as never] });
        jest.advanceTimersByTime(100);

        expect(checks).toBe(1);
    });
});
