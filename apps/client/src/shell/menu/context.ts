import { isOpenableView, type SplitLayout } from '@ruimte/contracts';
import type { MenuContext, MenuHost } from '@/commands/menu-context';
import { menuFactsOf } from '@/commands/menu-facts';
import { keepAwakeAvailable, keepAwakeChoice } from '@/controllers/keep-awake';
import { desktop, isApplePlatform } from '@/desktop/bridge';
import { canSplit, cellAt, cellCount, cellsRightOf, focusDirection, freeViewFor, isTabHost, maximizedCell, type SplitDirection } from '@/layout/split';
import { viewStepTarget } from '@/project/views';
import { canOpenWindows } from '@/project/windows';
import { activeViewOf, useDocument } from '@/state/document';
import { hasLocalMachine } from '@/state/local-machine';
import { isScratchProject, shownFolderOf, useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { nameOf } from '@/views/active-view';
import { windowWorkspace } from '@/workspace/window';

/* The focused cell as a host of tabs, which the Tab commands of the menu read. */
function tabsOf(layout: SplitLayout | null): MenuContext['tabs'] {
    const cell = layout === null ? null : cellAt(layout, layout.focus);
    if (layout === null || cell === null || !isTabHost(cell)) {
        return { hosted: false, count: 0, index: 0, splitOff: false };
    }
    const tabs = cell.tabs ?? [];

    return {
        hosted: true,
        count: tabs.length,
        index: tabs.indexOf(cell.viewId),
        splitOff: tabs.length > 1 && canSplit(layout, layout.focus, 'right', cell.viewId)
    };
}

const DIRECTIONS: SplitDirection[] = ['left', 'right', 'up', 'down'];

/* The moment the menu is built for: the window's own facts, and each feature's beside them. */
export function menuContext(host: MenuHost): MenuContext {
    const documentState = useDocument.getState();
    const ui = useUi.getState();
    const layout = documentState.layout;
    const free = freeViewFor(documentState);
    const room = (direction: 'right' | 'down'): boolean => layout !== null && free !== null && canSplit(layout, layout.focus, direction, free);
    const current = useProject.getState().current;
    const view = activeViewOf(documentState);

    return {
        host,
        apple: isApplePlatform(),
        workspace: windowWorkspace() !== null,
        folder: shownFolderOf(current) !== null,
        scratch: isScratchProject(current),
        view: view?.kind ?? null,
        cells: layout === null ? 0 : cellCount(layout),
        tabs: tabsOf(layout),
        split: { right: room('right'), down: room('down') },
        maximized: maximizedCell(layout, documentState.maximized) !== null,
        closesRight: layout !== null && cellsRightOf(layout, layout.focus) > 0,
        cellNeighbors: Object.fromEntries(
            DIRECTIONS.map((direction) => [direction, layout !== null && focusDirection(layout, direction) !== layout])
        ) as Record<SplitDirection, boolean>,
        viewsSteppable: viewStepTarget(1) !== null,
        panel: ui.panel.open ? ui.panel.kind : null,
        sidebar: ui.sidebarOpen,
        views: documentState.views.filter(isOpenableView).map(nameOf),
        releaseNotes: typeof desktop()?.releaseNotes === 'function',
        fullscreen: typeof document !== 'undefined' && document.fullscreenElement !== null,
        keepAwake: host === 'desktop' && keepAwakeAvailable() ? keepAwakeChoice().keepAwake : null,
        settingsOpen: ui.settings.open,
        windows: host === 'desktop' && canOpenWindows(),
        localMachine: hasLocalMachine(),
        ...menuFactsOf(host)
    } as MenuContext;
}
