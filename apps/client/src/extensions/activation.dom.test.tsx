import { afterEach, describe, expect, jest, test } from 'bun:test';
import { watchActivation } from '@/extensions/activation';
import { focusedCanvas } from '@/state/canvas';
import type { CanvasNode } from '@/state/canvas-model';
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
