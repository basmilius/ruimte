import { describe, expect, test } from 'bun:test';
import { readWindowTarget, windowSearch } from './window-target';

describe('readWindowTarget', () => {
    test('reads a project from its key', () => {
        expect(readWindowTarget('?project=local%3Ap1')).toEqual({ kind: 'project', endpointId: 'local', projectId: 'p1' });
    });

    test('reads the view a window opened on a project shows first', () => {
        expect(readWindowTarget('?project=local%3Ap1&view=chat-1')).toEqual({ kind: 'project', endpointId: 'local', projectId: 'p1', viewId: 'chat-1' });
        expect(readWindowTarget('?start=1&view=chat-1')).toEqual({ kind: 'start' });
    });

    test('reads the start screen', () => {
        expect(readWindowTarget('?start=1')).toEqual({ kind: 'start' });
    });

    test('a bare address is what a cold start opens', () => {
        expect(readWindowTarget('')).toEqual({ kind: 'last' });
    });

    test('a key without a machine or a project is no project', () => {
        expect(readWindowTarget('?project=p1')).toEqual({ kind: 'last' });
        expect(readWindowTarget('?project=local%3A&start=1')).toEqual({ kind: 'start' });
    });
});

describe('windowSearch', () => {
    test('writes a project and reads back the same', () => {
        expect(readWindowTarget(windowSearch('', 'daemon-b:q1'))).toEqual({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' });
    });

    test('moving to the start screen drops the project', () => {
        expect(windowSearch('?project=local%3Ap1', null)).toBe('?start=1');
    });

    test('claiming a project drops the view the shell asked for, so a reload keeps what the window shows', () => {
        expect(windowSearch('?project=local%3Ap1&view=chat-1', 'local:p1')).toBe('?project=local%3Ap1');
    });

    test('keeps what else the address carried', () => {
        expect(windowSearch('?debug=1&start=1', 'local:p1')).toBe('?debug=1&project=local%3Ap1');
    });
});
