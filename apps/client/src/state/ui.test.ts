import { beforeEach, describe, expect, test } from 'bun:test';
import { parsePanel, parsePreview, parseWidth, storedPanelOf, useUi } from './ui';

describe('ui', () => {
    beforeEach(() => {
        useUi.setState({
            sidebarOpen: true,
            panel: { open: false, kind: 'files' },
            preview: { open: false },
            panelWidth: null,
            previewWidth: null,
            panelsRestoring: true
        });
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

    // The panels live in the project's local file now; the keys below are only what a project that
    // has none of its own starts from, so reading them is the half that still matters.
    test('the panel the legacy key names is what a project without panels starts from', () => {
        expect(parsePanel('git')).toEqual({ open: true, kind: 'git' });
        expect(parsePanel('closed:git')).toEqual({ open: false, kind: 'git' });
        expect(parsePanel('files')).toEqual({ open: true, kind: 'files' });
    });

    test('the preview opens and closes on its own, next to whichever panel is up', () => {
        useUi.getState().togglePanel('files');
        useUi.getState().setPreviewOpen(true);
        expect(useUi.getState().preview).toEqual({ open: true });
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'files' });
        useUi.getState().togglePanel('files');
        expect(useUi.getState().preview).toEqual({ open: true });
        useUi.getState().setPreviewOpen(false);
        expect(useUi.getState().preview).toEqual({ open: false });
    });

    test('only an open preview is stored as open, and a width has to be a positive number', () => {
        expect(parsePreview('open')).toEqual({ open: true });
        expect(parsePreview(null)).toEqual({ open: false });
        expect(parsePreview('yes')).toEqual({ open: false });
        expect(parseWidth('540')).toBe(540);
        expect(parseWidth(null)).toBeNull();
        expect(parseWidth('wide')).toBeNull();
        expect(parseWidth('-10')).toBeNull();
    });

    test('nothing stored, or something else entirely, lands on a closed files panel', () => {
        expect(parsePanel(null)).toEqual({ open: false, kind: 'files' });
        expect(parsePanel('')).toEqual({ open: false, kind: 'files' });
        expect(parsePanel('terminal')).toEqual({ open: false, kind: 'files' });
        expect(parsePanel('closed:terminal')).toEqual({ open: false, kind: 'files' });
    });

    /* The columns may not animate while they are showing what was stored: on a cold load the panels
       are closed until the project's local file arrives, and that arrival is a width change of its
       own. `panelsRestoring` is what `useInstantWidth` reads, so this is the whole sequence that
       has to land at once, and the first change made by hand is where the sliding starts. */
    test('a restored panel lands at its width and only a change made by hand slides', () => {
        expect(useUi.getState().panel.open).toBe(false);
        expect(useUi.getState().panelsRestoring).toBe(true);

        useUi.getState().setPanels({ panel: { open: true, kind: 'files' }, preview: { open: false }, panelWidth: 720, previewWidth: null });
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'files' });
        expect(useUi.getState().panelWidth).toBe(720);
        expect(useUi.getState().panelsRestoring).toBe(true);

        useUi.getState().togglePanel('files');
        expect(useUi.getState().panelsRestoring).toBe(false);

        // A project that opens after that brings its own panels, which land without sliding again.
        useUi.getState().setPanels({ panel: { open: false, kind: 'git' }, preview: { open: false }, panelWidth: null, previewWidth: null });
        expect(useUi.getState().panelsRestoring).toBe(true);
    });

    test('every column a person moves turns the transition back on', () => {
        const moves: Array<() => void> = [
            () => useUi.getState().setPanel({ open: true }),
            () => useUi.getState().togglePanel('git'),
            () => useUi.getState().setPreviewOpen(true),
            () => useUi.getState().setPanelWidth(600),
            () => useUi.getState().setPreviewWidth(480),
            () => useUi.getState().setSidebarOpen(false)
        ];
        for (const move of moves) {
            useUi.setState({ panelsRestoring: true });
            move();
            expect(useUi.getState().panelsRestoring).toBe(false);
        }
    });

    test('a restore is one update, so the panel and its width reach the screen together', () => {
        let notified = 0;
        const unsubscribe = useUi.subscribe(() => {
            notified += 1;
        });
        useUi.getState().setPanels({ panel: { open: true, kind: 'files' }, preview: { open: true }, panelWidth: 720, previewWidth: 480 });
        unsubscribe();
        expect(notified).toBe(1);
    });

    test("a sub-agent's conversation takes the panel, goes down and back up its breadcrumb, and is replaced by the next one", () => {
        useUi.setState({ subagentPanel: null });
        useUi.getState().togglePanel('git');
        useUi.getState().openSubagentPanel('machine-1', 'chat-1', { toolUseId: 'toolu_1', description: 'Survey' });
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'subagent' });
        useUi.getState().openSubagentChild({ toolUseId: 'toolu_2', description: 'Count' });
        useUi.getState().openSubagentChild({ toolUseId: 'toolu_3', description: 'Deeper' });
        expect(useUi.getState().subagentPanel?.trail.map((crumb) => crumb.toolUseId)).toEqual(['toolu_1', 'toolu_2', 'toolu_3']);
        useUi.getState().openSubagentCrumb(0);
        expect(useUi.getState().subagentPanel?.trail.map((crumb) => crumb.toolUseId)).toEqual(['toolu_1']);

        useUi.getState().openSubagentPanel('machine-1', 'chat-2', { toolUseId: 'toolu_9', description: 'Other' });
        expect(useUi.getState().subagentPanel).toEqual({
            endpointId: 'machine-1',
            chatId: 'chat-2',
            trail: [{ toolUseId: 'toolu_9', description: 'Other' }],
            before: 'git'
        });
    });

    test("the project's file keeps the panel a sub-agent's conversation covered, closed, and never the conversation", () => {
        const subagentPanel = { endpointId: 'm', chatId: 'c', trail: [], before: 'processes' as const };
        expect(storedPanelOf({ open: true, kind: 'subagent' }, subagentPanel)).toEqual({ open: false, kind: 'processes' });
        expect(storedPanelOf({ open: true, kind: 'git' }, subagentPanel)).toEqual({ open: true, kind: 'git' });
        expect(storedPanelOf({ open: true, kind: 'subagent' }, null)).toEqual({ open: false, kind: 'files' });
    });
});
