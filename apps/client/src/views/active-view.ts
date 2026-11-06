import { forkRefusal, lastSettledTurn } from '@adecore/agents-react/chat';
import { useChats, providersOf } from '@adecore/agents-react/state';
import { canShareView, chatIsWorking, isCanvasView, isChatHostView, isEmptyChatView, type ProjectView } from '@ruimte/contracts';
import i18next from 'i18next';
import { databaseViewShareRefusal } from '@/database/view-sharing';
import type { SessionHandoff } from '@/project/views';
import { proposalsOf } from '@/proposals/proposals';
import { currentEndpointId } from '@/state/current-endpoint';
import { activeViewOf, hasActiveCanvas, useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { isScratchProject, useProject } from '@/state/project';
import { useSessions } from '@/state/sessions';
import { pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { sessionHandoffs, viewOffers, type ViewOffers } from '@/views/view-offers';

export interface ActiveViewFacts {
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
export function nameOf(view: ProjectView): string {
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
    const forkTurn = settled !== null && forkRefusal(chatRow?.info ?? null, chatRow?.structure[settled], providersOf(endpointId)) === null ? settled : null;
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

/* Runs against the view with the focus, and does nothing once it is gone. */
export function withActiveView(run: (facts: ActiveViewFacts) => void): () => void {
    return () => {
        const facts = activeViewFacts();
        if (facts !== null) {
            run(facts);
        }
    };
}
