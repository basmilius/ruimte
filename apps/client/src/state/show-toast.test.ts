import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { UNDO_MS } from '@adecore/ui';
import type { ProjectCanvasView, ProjectDocument } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useToasts } from '@/state/toasts';
import { backOffer, goOffer, SHOW_TOAST_ID, showMoveToast } from './show-toast';

function view(id: string): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] };
}

function document(views: ProjectCanvasView[]): ProjectDocument {
    return { version: 3, rev: 1, name: 'p', color: '#000', views };
}

function card() {
    return useToasts.getState().toasts.find((toast) => toast.id === SHOW_TOAST_ID) ?? null;
}

function press(): void {
    card()?.action?.run();
}

/* The two an agent can leave: the request nothing moved for, and the way back out of a view that took the cell. */
function asks(viewId: string, title = 'asked'): void {
    showMoveToast(title, goOffer(viewId));
}

function showed(viewId: string, title = 'showed'): void {
    const shown = useDocument.getState().showView(viewId)!;
    showMoveToast(title, backOffer(shown));
}

beforeEach(() => {
    jest.useFakeTimers();
    useToasts.setState({ toasts: [] });
    focusedCanvas().getState().setViewport({ w: 800, h: 600 });
    useDocument.getState().load(document([view('a'), view('b')]), { activeViewId: 'a', views: {} });
});

afterEach(() => {
    useToasts.getState().dismiss(SHOW_TOAST_ID);
    useToasts.setState({ toasts: [] });
    jest.useRealTimers();
});

describe('the toast a show leaves', () => {
    test('offers its button and goes by itself after the undo time', () => {
        asks('b');
        expect(card()).toMatchObject({ kind: 'success', title: 'asked', action: { label: 'Go there' } });

        jest.advanceTimersByTime(UNDO_MS - 1);
        expect(card()).not.toBeNull();

        jest.advanceTimersByTime(1);
        expect(card()).toBeNull();
    });

    test('the request goes where it names and is done', () => {
        asks('b');
        press();
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(card()).toBeNull();
    });

    test('the way back puts the grid back and is done', () => {
        showed('b');
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(card()?.action?.label).toBe('Back');

        press();
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(card()).toBeNull();
    });

    test('dismissing either one leaves the grid where it is', () => {
        asks('b');
        const before = useDocument.getState().layout;
        useToasts.getState().dismiss(SHOW_TOAST_ID);
        expect(useDocument.getState().layout).toBe(before);
        expect(useDocument.getState().activeViewId).toBe('a');

        showed('b');
        useToasts.getState().dismiss(SHOW_TOAST_ID);
        expect(useDocument.getState().activeViewId).toBe('b');
    });

    test('switching view by hand drops the way back, since it describes a grid that is gone', () => {
        showed('b');
        useDocument.getState().setActiveView('a');
        expect(card()).toBeNull();
    });

    test('a request survives a switch of your own, unless the switch is you arriving there', () => {
        asks('b');
        useDocument.getState().addCanvasView('c');
        expect(card()).not.toBeNull();

        useDocument.getState().setActiveView('b');
        expect(card()).toBeNull();
    });

    test('a second show replaces the toast, and the way back is then out of the second view', () => {
        const third = useDocument.getState().addCanvasView('c');
        useDocument.getState().setActiveView('a');
        showed('b', 'first');
        showed(third, 'second');
        expect(useToasts.getState().toasts.map((toast) => toast.title)).toEqual(['second']);

        press();
        expect(useDocument.getState().activeViewId).toBe('b');
    });

    test('a view that is deleted or a project that is swapped out takes its toast with it', () => {
        asks('b');
        useDocument.getState().deleteView('b');
        expect(card()).toBeNull();

        asks('a');
        useDocument.getState().load(document([view('c')]), { activeViewId: 'c', views: {} });
        expect(card()).toBeNull();
    });

    test('a show without an offer only reports', () => {
        showMoveToast('already there', null);
        expect(card()).toMatchObject({ kind: 'success', title: 'already there' });
        expect(card()?.action).toBeUndefined();
    });
});
