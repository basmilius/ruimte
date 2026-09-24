import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { elapsedOf, SUCCESS_MS, UNDO_MS, useToasts } from '@/state/toasts';

describe('useToasts', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        for (const toast of useToasts.getState().toasts) {
            useToasts.getState().dismiss(toast.id);
        }
        jest.useRealTimers();
    });

    const ids = (): string[] => useToasts.getState().toasts.map((toast) => toast.id);

    test('a success takes itself away', () => {
        useToasts.getState().show({ id: 'pushed', title: 'Pushed', kind: 'success' });
        jest.advanceTimersByTime(SUCCESS_MS + 1);
        expect(ids()).toEqual([]);
    });

    test('a success with persist still stands after the time a success gets', () => {
        useToasts.getState().show({ id: 'updated', title: 'Updated to version 0.0.9', kind: 'success', persist: true });
        jest.advanceTimersByTime(SUCCESS_MS + 1);
        expect(ids()).toEqual(['updated']);
    });

    test('an update keeps the persist the toast was shown with', () => {
        useToasts.getState().show({ id: 'updated', title: 'Updating', kind: 'progress', persist: true });
        useToasts.getState().update('updated', { kind: 'success' });
        jest.advanceTimersByTime(SUCCESS_MS + 1);
        expect(ids()).toEqual(['updated']);
    });

    test('an offer to undo stays longer than a success, then goes and says so', () => {
        const closed: string[] = [];
        useToasts.getState().show({ id: 'deleted', title: 'Deleted view', kind: 'deleted', onClose: () => closed.push('deleted') });
        jest.advanceTimersByTime(SUCCESS_MS + 1);
        expect(ids()).toEqual(['deleted']);
        jest.advanceTimersByTime(UNDO_MS - SUCCESS_MS);
        expect(ids()).toEqual([]);
        expect(closed).toEqual(['deleted']);
    });

    test('a toast that is dismissed says so once, and its timer never fires after', () => {
        const closed: string[] = [];
        useToasts.getState().show({ id: 'deleted', title: 'Deleted view', kind: 'deleted', onClose: () => closed.push('deleted') });
        useToasts.getState().dismiss('deleted');
        jest.advanceTimersByTime(UNDO_MS + 1);
        expect(closed).toEqual(['deleted']);
    });

    test('an offer to undo carries the deadline of the timer that takes it away', () => {
        jest.setSystemTime(10_000);
        useToasts.getState().show({ id: 'deleted', title: 'Deleted view', kind: 'deleted' });
        const deadline = useToasts.getState().toasts[0]?.deadline;
        expect(deadline).toEqual({ start: 10_000, end: 10_000 + UNDO_MS });
        jest.advanceTimersByTime(UNDO_MS - 1);
        expect(ids()).toEqual(['deleted']);
        jest.advanceTimersByTime(1);
        expect(ids()).toEqual([]);
    });

    test('an update that starts the timer over moves the deadline with it', () => {
        jest.setSystemTime(10_000);
        useToasts.getState().show({ id: 'pushed', title: 'Pushing', kind: 'progress' });
        expect(useToasts.getState().toasts[0]?.deadline).toBeUndefined();
        jest.advanceTimersByTime(3000);
        useToasts.getState().update('pushed', { kind: 'success' });
        expect(useToasts.getState().toasts[0]?.deadline).toEqual({ start: 13_000, end: 13_000 + SUCCESS_MS });
        useToasts.getState().update('pushed', { kind: 'error' });
        expect(useToasts.getState().toasts[0]?.deadline).toBeUndefined();
    });

    test('a failure waits for the person', () => {
        useToasts.getState().show({ id: 'failed', title: 'Push failed', kind: 'error' });
        jest.advanceTimersByTime(SUCCESS_MS + 1);
        expect(ids()).toEqual(['failed']);
    });
});

describe('elapsedOf', () => {
    const deadline = { start: 1000, end: 1000 + UNDO_MS };

    test('says how far the timer is, so a ring drawn late starts where the timer already is', () => {
        expect(elapsedOf(deadline, 3500)).toBe(2500);
    });

    test('stays inside the lifetime', () => {
        expect(elapsedOf(deadline, 500)).toBe(0);
        expect(elapsedOf(deadline, 1000 + UNDO_MS + 200)).toBe(UNDO_MS);
    });
});
