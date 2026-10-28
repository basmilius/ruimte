import { inPickerOrder } from '@/agents/creation';
import { groupArrangeable } from '@/canvas/arrange-group';
import i18next from 'i18next';
import {
    canShareView,
    chatIsWorking,
    isCanvasView,
    isChatHostView,
    isEmptyChatView,
    isOpenableView,
    type ProjectView,
    type SplitLayout
} from '@ruimte/contracts';
import { databaseViewShareRefusal } from '@/database/view-sharing';
import { forkRefusal, lastSettledTurn } from '@adecore/agents-react/chat';
import { desktop, isApplePlatform } from '@/desktop/bridge';
import { keepAwakeAvailable, keepAwakeChoice } from '@/state/keep-awake';
import { hasLocalMachine } from '@/state/local-machine';
import { newChatMachine, offersNewChat, useNewChat } from '@/project/new-chat';
import { canOpenWindows } from '@/project/windows';
import { moveTargetsOf } from '@/project/move-targets';
import { canOpenAsView, type SessionHandoff } from '@/project/views';
import { afterSettleCandidates, chosenLaunchId } from '@/launches/actions';
import { launchViews } from '@/launches/model';
import { useLaunches } from '@/launches/state';
import type { MenuContext, MenuHost, MenuLaunch } from '@/shell/menu/model';
import { canSplit, cellAt, cellCount, cellsRightOf, freeViewFor, isTabHost, maximizedCell } from '@/shell/split';
import { sessionHandoffs, viewOffers, type ViewOffers } from '@/shell/view-offers';
import { focusedCanvas, maximizedNodeOf, maximizeTargetOf, zoomNodeTargetOf } from '@/state/canvas';
import { useChats, providersOf } from '@adecore/agents-react/state';
import { useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { activeViewOf, hasActiveCanvas, useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { prReposOfCurrent } from '@/state/pr-repos';
import { proposalsOf } from '@/state/proposals';
import { isScratchProject, shownFolderOf, useProject } from '@/state/project';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { hasPrWatch } from '@/shell/pr-watch-actions';
import { focusedChatId } from '@/chat/focused-chat';
import { terminalHasFind, terminalHasKeyboard } from '@/terminal/xterm';
import { useUi } from '@/state/ui';
import { windowWorkspace } from '@/state/window';

interface ActiveViewFacts {
    view: ProjectView;
    offers: ViewOffers;
    shared: boolean;
    asChat: SessionHandoff | null;
    asTerminal: SessionHandoff | null;
    workingFolder: string | null;
    /* The turn a fork starts after, or null when the chat has none to fork from. */
    forkTurn: string | null;
    /* The chat runs a turn or waits on a person. */
    working: boolean;
}

// A session view takes its title from its node until someone names it, and a menu row needs words.
function nameOf(view: ProjectView): string {
    return view.name ?? i18next.t(`shell:menu.kinds.${view.kind}`);
}

/* What the view with the focus offers, read the way `ViewMenuItems` reads it for any view. */
export function activeViewFacts(): ActiveViewFacts | null {
    const documentState = useDocument.getState();
    const view = activeViewOf(documentState);
    if (view === null) {
        return null;
    }
    const endpointId = currentEndpointId();
    const chatRow = useChats.getState().byKey[endpointKey(endpointId, view.id)];
    const session = useSessions.getState().byKey[endpointKey(endpointId, view.id)];
    const current = useProject.getState().current;
    const folder = current?.folder ?? null;
    const shared = documentState.shared.includes(view.id);
    const { asChat, asTerminal } = sessionHandoffs(view.kind, view, chatRow?.info, session, providersOf(endpointId).providers);
    const scratch = isScratchProject(current);
    const workingFolder = !scratch && (isChatHostView(view) || view.kind === 'terminal') ? (view.node.cwd ?? chatRow?.info.cwd ?? folder) : null;
    const settled = chatRow ? lastSettledTurn(chatRow.structure, chatRow.order) : null;
    const forkTurn = settled !== null && forkRefusal(chatRow?.info ?? null, chatRow?.structure[settled]) === null ? settled : null;
    const offers = viewOffers({
        kind: view.kind,
        shared,
        canShare: canShareView(view) && databaseViewShareRefusal(view) === null,
        hasCanvas: documentState.views.some(isCanvasView),
        onCanvas: hasActiveCanvas(documentState),
        offersFork: forkTurn !== null,
        asChat,
        asTerminal,
        workingFolder,
        // A file view's own actions stay in its view menu; the application menu has none of them.
        filePath: null,
        scratch,
        written: !(isChatHostView(view) && isEmptyChatView(view)),
        moves: machineAnswers(pool.statusOf(endpointId), 'chat.move')
    });
    const working = chatIsWorking(
        chatRow?.info,
        proposalsOf(endpointId).some((proposal) => proposal.chatId === view.id)
    );
    return { view, offers, shared, asChat, asTerminal, workingFolder, forkTurn, working };
}

/* The key of the project on screen in the launches store, or null outside a project. */
function launchesKey(endpointId: string): string | null {
    const projectId = useProject.getState().current?.projectId;
    return projectId === undefined ? null : endpointKey(endpointId, projectId);
}

/* The launches of the project on screen, each with whether it runs. */
function menuLaunches(endpointId: string): MenuLaunch[] {
    const key = launchesKey(endpointId);
    const { documents, statuses } = useLaunches.getState();
    const document = key === null ? undefined : documents[key];
    if (key === null || document === undefined) {
        return [];
    }
    const views = launchViews(document, statuses[key] ?? {});
    return document.launches.map((launch) => ({ id: launch.id, name: launch.name, live: views.get(launch.id)?.live === true }));
}

/* The tasks of the project on screen that may run after a worktree chat settles, and the one that does. */
function menuAfterSettle(endpointId: string): MenuContext['afterSettle'] {
    const key = launchesKey(endpointId);
    const document = key === null ? undefined : useLaunches.getState().documents[key];
    if (document === undefined) {
        return { tasks: [], chosen: null };
    }
    return {
        tasks: afterSettleCandidates(document).map((launch) => ({ id: launch.id, name: launch.name })),
        chosen: document.afterSettle?.launchId ?? null
    };
}

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

/* The moment the menu is built for, out of the stores. */
export function menuContext(host: MenuHost): MenuContext {
    const documentState = useDocument.getState();
    const ui = useUi.getState();
    const canvas = focusedCanvas().getState();
    const endpointId = currentEndpointId();
    const facts = activeViewFacts();
    const layout = documentState.layout;
    const free = freeViewFor(documentState);
    const room = (direction: 'right' | 'down'): boolean => layout !== null && free !== null && canSplit(layout, layout.focus, direction, free);
    const selected = canvas.selection.length === 1 ? canvas.nodes[canvas.selection[0]!] : undefined;
    const onCanvas = facts?.view.kind === 'canvas';
    return {
        host,
        apple: isApplePlatform(),
        workspace: windowWorkspace() !== null,
        folder: shownFolderOf(useProject.getState().current) !== null,
        scratch: isScratchProject(useProject.getState().current),
        prRepos: prReposOfCurrent().map((repo) => ({ path: repo.path, label: repo.label })),
        prWatch: onCanvas && selected?.kind === 'chat' && hasPrWatch(endpointId, selected.id),
        routines: windowWorkspace() !== null && machineAnswers(pool.statusOf(endpointId), 'routine.list'),
        chat: windowWorkspace() !== null && focusedChatId() !== null,
        terminalKeys: terminalHasKeyboard(),
        terminalFind: terminalHasFind(),
        fileManager: fileManagerName(serverInfoOf(endpointId).platform),
        view: facts?.view.kind ?? null,
        offers: facts?.offers ?? null,
        chatWorking: facts?.working ?? false,
        moveProjects:
            facts?.offers.moveToProject === true
                ? moveTargetsOf(useProjectList.getState().projects, useEndpoints.getState().endpoints, endpointId).map((summary) => ({
                      id: summary.projectId,
                      name: summary.name
                  }))
                : [],
        shared: facts?.shared ?? false,
        selection: onCanvas ? canvas.selection.length : 0,
        groupArrangeable: onCanvas && groupArrangeable(selected, canvas.locks),
        promote: onCanvas && selected !== undefined && canOpenAsView(selected.kind),
        anyLocked: Object.values(canvas.locks).some(Boolean),
        cells: layout === null ? 0 : cellCount(layout),
        tabs: tabsOf(layout),
        split: { right: room('right'), down: room('down') },
        maximized: maximizedCell(layout, documentState.maximized) !== null,
        nodeMaximizable: onCanvas && maximizeTargetOf(canvas) !== null,
        nodeMaximized: onCanvas && maximizedNodeOf(canvas) !== null,
        nodeZoomable: onCanvas && zoomNodeTargetOf(canvas) !== null,
        closesRight: layout !== null && cellsRightOf(layout, layout.focus) > 0,
        panel: ui.panel.open ? ui.panel.kind : null,
        sidebar: ui.sidebarOpen,
        views: documentState.views.filter(isOpenableView).map(nameOf),
        // The same targets as the palette's "Move node to" rows: one node, not a group, another canvas.
        moveTargets:
            onCanvas && selected !== undefined && selected.kind !== 'group'
                ? documentState.views
                      .filter((view) => isCanvasView(view) && view.id !== documentState.activeViewId)
                      .map((view) => ({ id: view.id, name: nameOf(view) }))
                : [],
        layouts: onCanvas ? canvas.layouts.map((layout) => layout.name) : [],
        agents: inPickerOrder(providersOf(endpointId).providers.filter((provider) => provider.installed)).map((provider) => ({
            kind: provider.kind,
            name: provider.name,
            chat: provider.capabilities.chat,
            terminal: provider.capabilities.terminal
        })),
        launches: menuLaunches(endpointId),
        chosenLaunch: chosenLaunchId(),
        afterSettle: menuAfterSettle(endpointId),
        releaseNotes: typeof desktop()?.releaseNotes === 'function',
        fullscreen: typeof document !== 'undefined' && document.fullscreenElement !== null,
        keepAwake: host === 'desktop' && keepAwakeAvailable() ? keepAwakeChoice().keepAwake : null,
        settingsOpen: ui.settings.open,
        windows: host === 'desktop' && canOpenWindows(),
        newChat: offersNewChat(newChatMachine(), useNewChat.getState().refused),
        localMachine: hasLocalMachine()
    };
}
