import { beforeEach, describe, expect, test } from 'bun:test';
import { useUi } from './ui';

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
});
