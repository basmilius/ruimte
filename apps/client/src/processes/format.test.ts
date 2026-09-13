import { describe, expect, test } from 'bun:test';
import type { ProcessAlert, ProcessGroup, ProcessPoint } from '@ruimte/contracts';
import { alertActions, alertPlacement, alertText, chartSeries, formatBytes, formatDuration, formatPercent, formatRate, groupTitle } from './format.ts';

const alert = (overrides: Partial<ProcessAlert>): ProcessAlert => ({
    id: 'a',
    kind: 'silent',
    nodeId: 'node-1',
    pid: 201,
    startTime: 5,
    name: 'vitest',
    since: 0,
    value: null,
    ...overrides
});

const group = (overrides: Partial<ProcessGroup>): ProcessGroup => ({
    id: 'terminal:node-1',
    kind: 'terminal',
    nodeId: 'node-1',
    cpu: 0,
    memory: 0,
    diskRead: 0,
    diskWrite: 0,
    processes: [],
    hidden: 0,
    ...overrides
});

const point = (at: number): ProcessPoint => ({ at, cpu: 1, cpuRuimte: 1, memory: 1, memoryRuimte: 1, disk: 0, diskRuimte: 0 });

describe('the numbers', () => {
    test('an unreadable number is a dash, never a zero', () => {
        expect(formatPercent(null)).toBe('-');
        expect(formatBytes(null)).toBe('-');
        expect(formatRate(null)).toBe('-');
    });

    test('sizes and shares read at a glance', () => {
        expect(formatPercent(3.456)).toBe('3.5%');
        expect(formatPercent(87.4)).toBe('87%');
        expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB');
        expect(formatBytes(410 * 1024 ** 2)).toBe('410 MB');
        expect(formatRate(150 * 1024)).toBe('150 KB/s');
        expect(formatDuration(14 * 60_000)).toBe('14 min');
        expect(formatDuration(45_000)).toBe('45 s');
    });
});

describe('the charts', () => {
    test('draw the coarse day until the fine series has a line of its own', () => {
        expect(chartSeries([point(1)], [point(0), point(1)]).fine).toBe(false);
        expect(chartSeries([point(1), point(2)], []).windowMs).toBe(600_000);
    });
});

describe('the warnings', () => {
    test('say what is wrong in one sentence and offer the button that fits', () => {
        expect(alertText(alert({ kind: 'silent', since: 0 }), 14 * 60_000)).toBe('Working, but silent for 14 min');
        expect(alertText(alert({ kind: 'agent-gone', name: 'claude' }), 0)).toBe('Claude Code is gone, but its status still says it runs');
        expect(alertText(alert({ kind: 'busy-after-turn', value: 95 }), 0)).toBe('vitest keeps using 95% of a core after the turn ended');
        expect(alertActions(alert({ kind: 'busy-after-turn' }))).toEqual(['show', 'terminate']);
        expect(alertActions(alert({ kind: 'agent-gone' }))).toEqual(['resume']);
    });

    test('sit under their node, else under the row of their process, else above the list', () => {
        const groups = [
            group({}),
            group({ id: 'daemon', kind: 'daemon', nodeId: null, processes: [{ pid: 400, startTime: 9 } as ProcessGroup['processes'][number]] })
        ];
        expect(alertPlacement(alert({}), groups)).toBe('terminal:node-1');
        expect(alertPlacement(alert({ kind: 'probe-hung', nodeId: null, pid: 400, startTime: 9 }), groups)).toBe('daemon');
        expect(alertPlacement(alert({ kind: 'orphan', nodeId: 'gone', pid: 777 }), groups)).toBeNull();
    });

    test('a node this project does not hold still gets a name', () => {
        expect(groupTitle(group({}), new Map([['node-1', 'dev server']]))).toEqual({ title: 'dev server', known: true });
        expect(groupTitle(group({}), new Map())).toEqual({ title: 'Terminal', known: false });
        expect(groupTitle(group({ kind: 'daemon', nodeId: null }), new Map())).toEqual({ title: 'Machine tasks', known: true });
    });
});
