import { describe, expect, test } from 'bun:test';
import type { ProcessAlert, ProcessGroup, ProcessPoint } from '@ruimte/contracts';
import { alertActions, alertPlacement, alertText, chartSeries, formatBytes, formatPercent, formatRate, groupTitle } from './format.ts';

function alert(overrides: Partial<ProcessAlert>): ProcessAlert {
    return {
        id: 'a',
        kind: 'silent',
        nodeId: 'node-1',
        pid: 201,
        startTime: 5,
        name: 'vitest',
        since: 0,
        value: null,
        ...overrides
    };
}

function group(overrides: Partial<ProcessGroup>): ProcessGroup {
    return {
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
    };
}

function point(at: number): ProcessPoint {
    return { at, cpu: 1, cpuRuimte: 1, memory: 1, memoryRuimte: 1, disk: 0, diskRuimte: 0 };
}

describe('the numbers', () => {
    test('an unreadable number is a dash, never a zero', () => {
        expect(formatPercent(null)).toBe('-');
        expect(formatBytes(null)).toBe('-');
        expect(formatRate(null)).toBe('-');
    });

    test('a rate is a size per second', () => {
        expect(formatRate(150 * 1024)).toBe(`${formatBytes(150 * 1024)}/s`);
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
        expect(alertText(alert({ kind: 'agent-gone', name: 'claude' }), 0)).toBe('Claude Code has exited, but still shows as running');
        expect(alertText(alert({ kind: 'busy-after-turn', value: 95 }), 0)).toBe('vitest still uses 95% of a core after its turn ended');
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
        expect(groupTitle(group({ nodeId: 'launch-1', label: 'Run server' }), new Map())).toEqual({ title: 'Run server', known: true });
    });
});
