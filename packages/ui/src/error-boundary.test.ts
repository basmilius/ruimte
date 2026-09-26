import { describe, expect, test } from 'bun:test';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { errorMessageOf, errorReport, shouldReset } from './error-boundary.ts';

/*
 * No DOM renderer is installed in the client, so the render itself (the message standing in for a
 * child that throws, a sibling left alone) is not tested here; the decisions it rests on are.
 */
describe('shouldReset', () => {
    const view = { id: 'v1' };

    test('a boundary without an error never resets, whatever its keys do', () => {
        expect(shouldReset(false, ['a', 1], ['b', 2])).toBe(false);
    });

    test('a failed boundary resets when a key changes', () => {
        expect(shouldReset(true, ['v1', 4], ['v1', 5])).toBe(true);
        expect(shouldReset(true, [view], [{ id: 'v1' }])).toBe(true);
    });

    test('a failed boundary stays down while its keys are the same', () => {
        expect(shouldReset(true, ['v1', view, 4], ['v1', view, 4])).toBe(false);
        expect(shouldReset(true, [], [])).toBe(false);
        expect(shouldReset(true, [Number.NaN], [Number.NaN])).toBe(false);
    });

    test('a key that appears or goes away counts as a change', () => {
        expect(shouldReset(true, ['v1'], ['v1', 1])).toBe(true);
    });
});

describe('ErrorBoundary state', () => {
    const boundary = (resetKeys: unknown[]): { instance: ErrorBoundary; states: unknown[] } => {
        const instance = new ErrorBoundary({ label: 'This view failed to render', resetKeys, children: null });
        const states: unknown[] = [];
        instance.setState = ((next: object) => {
            states.push(next);
            instance.state = { ...instance.state, ...next };
        }) as ErrorBoundary['setState'];
        return { instance, states };
    };

    test('an error thrown below marks the boundary failed', () => {
        const error = new Error('boom');
        expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error, failed: true });
    });

    test('Try again clears the error so the child draws again', () => {
        const { instance } = boundary([]);
        instance.state = { error: new Error('boom'), failed: true, componentStack: null };
        instance.reset();
        expect(instance.state.failed).toBe(false);
    });

    test('a changed reset key clears the error, an unchanged one does not', () => {
        const { instance, states } = boundary(['v1', 5]);
        instance.state = { error: new Error('boom'), failed: true, componentStack: null };
        instance.componentDidUpdate({ label: 'x', resetKeys: ['v1', 5], children: null });
        expect(states).toHaveLength(0);
        instance.componentDidUpdate({ label: 'x', resetKeys: ['v1', 4], children: null });
        expect(instance.state.failed).toBe(false);
    });
});

describe('the message', () => {
    test('says something for anything that can be thrown', () => {
        expect(errorMessageOf(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe("Cannot read properties of undefined (reading 'x')");
        expect(errorMessageOf('plain')).toBe('plain');
        expect(errorMessageOf(undefined)).toBe('undefined');
    });

    test('the report carries the label, the stack and the component stack', () => {
        const error = new Error('boom');
        const report = errorReport('This node failed to render', error, '\n    at DiagramView');
        expect(report).toStartWith('This node failed to render\n\nError: boom');
        expect(report).toContain('Component stack:\n    at DiagramView');
        expect(errorReport('x', 'plain', null)).toBe('x\n\nplain');
    });
});
