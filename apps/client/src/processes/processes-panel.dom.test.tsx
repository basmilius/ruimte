import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProcessGroup, ProcessRow, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { clickOn, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const CHAT: ProjectNode = { id: 'review', kind: 'chat', title: 'Review', x: 0, y: 0, w: 560, h: 480 };
const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell', x: 600, y: 0, w: 560, h: 360 };
const WORK: ProjectCanvasView = { kind: 'canvas', id: 'work', name: 'Work', nodes: [CHAT, SHELL], texts: [], edges: [], layouts: [] };

function process(pid: number, name: string): ProcessRow {
    return { pid, startTime: pid, ppid: 1, name, path: null, readable: true, cpu: 1, memory: 1024, diskRead: 0, diskWrite: 0, family: null, depth: 0 };
}

function group(id: string, kind: ProcessGroup['kind'], nodeId: string | null, processes: ProcessRow[]): ProcessGroup {
    return {
        id,
        kind,
        nodeId,
        cpu: 1,
        memory: 1024,
        diskRead: 0,
        diskWrite: 0,
        processes,
        hidden: 0,
        ...(nodeId === null ? {} : { projectId: 'project-atlas' })
    };
}

let canvas: CanvasPage;
let machine: FakeMachine;
let before: Pick<ReturnType<typeof useUi.getState>, 'panel'>;

function rows(): HTMLElement[] {
    return [...canvas.page.host.querySelectorAll<HTMLElement>('[data-surface="panel"] button[aria-expanded]')];
}

/* The name of a row, without the initial a project's mark draws before it or the numbers after it. */
function nameOf(entry: HTMLElement): string {
    return entry.querySelector('.truncate')?.textContent ?? '';
}

function row(name: string): HTMLElement | null {
    return rows().find((entry) => nameOf(entry) === name) ?? null;
}

beforeEach(async () => {
    before = { panel: useUi.getState().panel };
    machine = new FakeMachine();
    machine.answer('processes.subscribe', () => ({
        supported: true,
        fineIntervalMs: 2000,
        coarseIntervalMs: 300_000,
        fine: [],
        coarse: [],
        sample: {
            at: 0,
            scope: 'ruimte' as const,
            machine: { cores: 4, cpu: 50, memoryUsed: 8192, memoryTotal: 16384, diskRead: 0, diskWrite: 0, diskFree: null, diskTotal: null },
            // The daemon's own order, which the panel does not follow.
            groups: [
                group('daemon', 'daemon', null, [process(10, 'bun')]),
                group('terminal:shell', 'terminal', 'shell', [process(30, 'zsh')]),
                group('chat:review', 'chat', 'review', [process(20, 'claude')])
            ],
            fine: null,
            coarse: null,
            reset: false
        }
    }));
    canvas = await openCanvasPage(machine, [WORK], 'review');
    await act(async () => useUi.setState({ panel: { open: true, kind: 'processes' } }));
    await until(() => row('Atlas') !== null);
});

afterEach(async () => {
    await canvas.close();
    useUi.setState(before);
});

describe('the processes panel', () => {
    test('lists the project, its view and its nodes in sidebar order, then Ruimte itself', () => {
        expect(rows().map(nameOf)).toEqual(['Atlas', 'Work', 'Review', 'Shell', 'Ruimte itself', 'Machine tasks']);
        expect(machine.requests('processes.subscribe')).toEqual([{ scope: 'ruimte', sort: 'cpu' }]);
    });

    test('opens a node with a click anywhere on its row, and folds a project the same way', async () => {
        expect(canvas.page.host.textContent).not.toContain('claude');

        await clickOn(row('Review'));

        expect(canvas.page.host.textContent).toContain('claude');

        await clickOn(row('Atlas'));

        expect(row('Work')).toBeNull();
        expect(row('Atlas')?.getAttribute('aria-expanded')).toBe('false');
    });

    test('shows every value of the machine against what Ruimte takes of it', () => {
        expect(canvas.page.host.textContent).toContain('of which Ruimte');
        expect(canvas.page.host.textContent).toContain('Other processes');
    });
});
