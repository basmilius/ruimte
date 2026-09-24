import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectDocument } from '@ruimte/contracts';
import { useProject } from '@/state/project';
import { confirmLeavingConflict, useLeaveConflict } from './leave-conflict';

const conflict: ProjectDocument = { version: 3, rev: 9, name: 'p', color: '#000', views: [] };

afterEach(() => {
    useProject.getState().setConflict(null);
    useLeaveConflict.setState({ answer: null });
});

describe('leaving a project', () => {
    test('asks nothing without an open conflict', async () => {
        expect(await confirmLeavingConflict()).toBe(true);
        expect(useLeaveConflict.getState().answer).toBeNull();
    });

    test('with an open conflict waits for the person, and closes the question on the answer', async () => {
        useProject.getState().setConflict(conflict);
        const leaving = confirmLeavingConflict();
        expect(useLeaveConflict.getState().answer).not.toBeNull();

        useLeaveConflict.getState().answer!(true);
        expect(await leaving).toBe(true);
        expect(useLeaveConflict.getState().answer).toBeNull();
    });

    test('a second question stays for the first', async () => {
        useProject.getState().setConflict(conflict);
        const first = confirmLeavingConflict();
        const second = confirmLeavingConflict();

        expect(await first).toBe(false);
        useLeaveConflict.getState().answer!(false);
        expect(await second).toBe(false);
    });
});
