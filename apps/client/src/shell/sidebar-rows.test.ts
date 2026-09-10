import { describe, expect, test } from 'bun:test';
import type { AgentStatus } from '@/state/canvas';
import { groupRows, rowAfterArrow, rowOrder } from './sidebar-rows';

interface Row {
    id: string;
    status: AgentStatus | null;
}

const rows: Row[] = [
    { id: 'idle-1', status: 'idle' },
    { id: 'plain', status: null },
    { id: 'waiting', status: 'needs-you' },
    { id: 'busy', status: 'running' },
    { id: 'idle-2', status: 'idle' }
];

const statusOf = (row: Row): AgentStatus | null => row.status;

describe('groupRows', () => {
    test('groups by status, most urgent first, and drops the empty groups', () => {
        const groups = groupRows(rows, statusOf);
        expect(groups.map((group) => group.status)).toEqual(['needs-you', 'running', 'idle', 'none']);
        expect(groups[2]!.rows.map((row) => row.id)).toEqual(['idle-1', 'idle-2']);
    });

    test('leaves out a group nothing sits in', () => {
        const groups = groupRows([{ id: 'only', status: 'running' }], statusOf);
        expect(groups.map((group) => group.label)).toEqual(['Running']);
    });
});

describe('rowOrder', () => {
    test('reads the groups top to bottom', () => {
        expect(rowOrder(groupRows(rows, statusOf))).toEqual(['waiting', 'busy', 'idle-1', 'idle-2', 'plain']);
    });
});

describe('rowAfterArrow', () => {
    const order = ['a', 'b', 'c'];

    test('starts at the top on Down and at the bottom on Up', () => {
        expect(rowAfterArrow(order, null, 1)).toBe('a');
        expect(rowAfterArrow(order, null, -1)).toBe('c');
    });

    test('steps one row', () => {
        expect(rowAfterArrow(order, 'b', 1)).toBe('c');
        expect(rowAfterArrow(order, 'b', -1)).toBe('a');
    });

    test('stops at the ends instead of wrapping', () => {
        expect(rowAfterArrow(order, 'c', 1)).toBe('c');
        expect(rowAfterArrow(order, 'a', -1)).toBe('a');
    });

    test('has nowhere to go in an empty list', () => {
        expect(rowAfterArrow([], null, 1)).toBeNull();
    });
});
