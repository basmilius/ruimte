import i18next from 'i18next';
import { canShareView, isCanvasView, isOpenableView, type ProjectView } from '@ruimte/contracts';
import { forkRefusal, lastSettledTurn } from '@/chat/logic/fork';
import { desktop, isApplePlatform } from '@/desktop/bridge';
import { canOpenAsView, type SessionHandoff } from '@/project/views';
import type { MenuContext, MenuHost } from '@/shell/menu/model';
import { canSplit, cellCount, cellsRightOf, freeViewFor, maximizedCell } from '@/shell/split';
import { sessionHandoffs, viewOffers, type ViewOffers } from '@/shell/view-offers';
import { focusedCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { activeViewOf, hasActiveCanvas, useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { providersOf } from '@/state/providers';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { windowWorkspace } from '@/state/window';

export interface ActiveViewFacts {
    view: ProjectView;
    offers: ViewOffers;
    shared: boolean;
    asChat: SessionHandoff | null;
    asTerminal: SessionHandoff | null;
    workingFolder: string | null;
    /* The turn a fork starts after, or null when the chat has none to fork from. */
    forkTurn: string | null;
}

// A session view takes its title from its node until someone names it, and a menu row needs words.
const nameOf = (view: ProjectView): string => view.name ?? i18next.t(`shell:menu.kinds.${view.kind}`);

/* What the view with the focus offers, read the way `ViewMenuItems` reads it for any view. */
export const activeViewFacts = (): ActiveViewFacts | null => {
    const documentState = useDocument.getState();
    const view = activeViewOf(documentState);
    if (view === null) {
        return null;
    }
    const endpointId = currentEndpointId();
    const chatRow = useChats.getState().byKey[endpointKey(endpointId, view.id)];
    const agent = useSessions.getState().byKey[endpointKey(endpointId, view.id)]?.agent;
    const folder = useProject.getState().current?.folder ?? null;
    const shared = documentState.shared.includes(view.id);
    const { asChat, asTerminal } = sessionHandoffs(view.kind, view, chatRow?.info, agent, providersOf(endpointId).providers);
    const workingFolder = view.kind === 'chat' || view.kind === 'terminal' ? (view.node.cwd ?? chatRow?.info.cwd ?? folder) : null;
    const settled = chatRow ? lastSettledTurn(chatRow.structure, chatRow.order) : null;
    const forkTurn = settled !== null && forkRefusal(chatRow?.info ?? null, chatRow?.structure[settled]) === null ? settled : null;
    const offers = viewOffers({
        kind: view.kind,
        shared,
        canShare: canShareView(view),
        hasCanvas: documentState.views.some(isCanvasView),
        onCanvas: hasActiveCanvas(documentState),
        offersFork: forkTurn !== null,
        asChat,
        asTerminal,
        workingFolder,
        // A file view's own actions stay in its view menu; the application menu has none of them.
        filePath: null
    });
    return { view, offers, shared, asChat, asTerminal, workingFolder, forkTurn };
};

/* The moment the menu is built for, out of the stores. */
export const menuContext = (host: MenuHost): MenuContext => {
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
        folder: (useProject.getState().current?.folder ?? null) !== null,
        fileManager: fileManagerName(serverInfoOf(endpointId).platform),
        view: facts?.view.kind ?? null,
        offers: facts?.offers ?? null,
        shared: facts?.shared ?? false,
        selection: onCanvas ? canvas.selection.length : 0,
        promote: onCanvas && selected !== undefined && canOpenAsView(selected.kind),
        anyLocked: Object.values(canvas.locks).some(Boolean),
        cells: layout === null ? 1 : cellCount(layout),
        split: { right: room('right'), down: room('down') },
        maximized: maximizedCell(layout, documentState.maximized) !== null,
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
        agents: providersOf(endpointId)
            .providers.filter((provider) => provider.installed)
            .map((provider) => ({ kind: provider.kind, name: provider.name, chat: provider.capabilities.chat, terminal: provider.capabilities.terminal })),
        releaseNotes: typeof desktop()?.releaseNotes === 'function',
        fullscreen: typeof document !== 'undefined' && document.fullscreenElement !== null
    };
};
