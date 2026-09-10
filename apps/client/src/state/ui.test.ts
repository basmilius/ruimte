import { beforeEach, describe, expect, test } from 'bun:test';
import { parsePanel, serializePanel, useUi } from './ui';

describe('ui', () => {
    beforeEach(() => {
        useUi.setState({ sidebarOpen: true, panel: { open: false, kind: 'files' } });
    });

    test('the sidebar starts open where no storage answers and follows the toggle', () => {
        expect(useUi.getState().sidebarOpen).toBe(true);
        useUi.getState().toggleSidebar();
        expect(useUi.getState().sidebarOpen).toBe(false);
        useUi.getState().setSidebarOpen(true);
        expect(useUi.getState().sidebarOpen).toBe(true);
    });

    test('a panel toggle opens its own kind and closes only that kind', () => {
        useUi.getState().togglePanel('files');
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'files' });
        useUi.getState().togglePanel('git');
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'git' });
        useUi.getState().togglePanel('git');
        expect(useUi.getState().panel).toEqual({ open: false, kind: 'git' });
    });

    test('a toggle without a kind reopens the panel that was up last', () => {
        useUi.getState().togglePanel('git');
        useUi.getState().togglePanel();
        expect(useUi.getState().panel).toEqual({ open: false, kind: 'git' });
        useUi.getState().togglePanel();
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'git' });
    });

    // The store reads and writes localStorage, which `bun test` has none of; the round trip is
    // what the reload depends on, so the two halves are tested on their own.
    test('the panel that was up survives the round trip through storage', () => {
        for (const panel of [
            { open: true, kind: 'files' as const },
            { open: true, kind: 'git' as const },
            { open: false, kind: 'git' as const }
        ]) {
            expect(parsePanel(serializePanel(panel))).toEqual(panel);
        }
    });

    test('nothing stored, or something else entirely, lands on a closed files panel', () => {
        expect(parsePanel(null)).toEqual({ open: false, kind: 'files' });
        expect(parsePanel('')).toEqual({ open: false, kind: 'files' });
        expect(parsePanel('terminal')).toEqual({ open: false, kind: 'files' });
        expect(parsePanel('closed:terminal')).toEqual({ open: false, kind: 'files' });
    });
});
