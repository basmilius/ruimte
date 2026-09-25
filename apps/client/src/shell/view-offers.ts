import type { ProjectView, ProviderInfo } from '@ruimte/contracts';
import type { SessionHandoff } from '@/project/views';

/* A view a person drew on a surface of its own is duplicated rather than moved to a canvas. */
const DRAWN_KINDS: readonly ProjectView['kind'][] = ['canvas', 'drawing', 'diagram'];

export const isDrawnKind = (kind: ProjectView['kind']): boolean => DRAWN_KINDS.includes(kind);

export interface ViewOffersInput {
    kind: ProjectView['kind'];
    shared: boolean;
    /* False for a view that cannot travel, and for one that is not in the document (yet). */
    canShare: boolean;
    /* There is a canvas to put the view on. */
    hasCanvas: boolean;
    /* The view on screen is a canvas, which is where "show on the canvas" lands. */
    onCanvas: boolean;
    offersFork: boolean;
    asChat: SessionHandoff | null;
    asTerminal: SessionHandoff | null;
    /* The folder a session view works in, or null for any other kind. */
    workingFolder: string | null;
    /* The daemon's path of what a file view holds. */
    filePath: string | null;
}

export interface ViewOffers {
    duplicate: boolean;
    openInChat: boolean;
    openInTerminal: boolean;
    fork: boolean;
    putOnCanvas: boolean;
    showOnCanvas: boolean;
    reveal: boolean;
    share: boolean;
}

/*
 * What a view can be asked, so the sidebar, the view menu, a cell's bar and the application menu read
 * the same rule. A row that needs a canvas to land on is left out without one rather than greyed.
 */
export const viewOffers = (input: ViewOffersInput): ViewOffers => {
    const drawn = isDrawnKind(input.kind);
    return {
        duplicate: drawn,
        openInChat: input.asChat !== null,
        openInTerminal: input.asTerminal !== null,
        fork: input.kind === 'chat' && input.offersFork,
        putOnCanvas: !drawn && input.kind !== 'file' && input.hasCanvas,
        showOnCanvas: (input.kind === 'drawing' || input.kind === 'diagram') && input.onCanvas,
        reveal: input.workingFolder !== null,
        // A divider goes where the group under it goes and is nobody's to share.
        share: input.kind !== 'separator' && input.kind !== 'subheader' && (input.shared || input.canShare)
    };
};

/*
 * The same session in the other kind of view. A terminal only goes on in a chat where the daemon
 * has a chat backend for that CLI, and a chat only goes on in a terminal once the CLI has told it
 * which session it is, which is what the resume line is built from.
 */
export const sessionHandoffs = (
    kind: ProjectView['kind'],
    view: ProjectView | undefined,
    chat: { agentSessionId?: string | null; provider: SessionHandoff['provider']; cwd?: string; account?: string } | undefined,
    session: { agent?: { kind: SessionHandoff['provider']; agentSessionId: string } | null; account?: string } | undefined,
    providers: readonly ProviderInfo[]
): { asChat: SessionHandoff | null; asTerminal: SessionHandoff | null } => {
    const agent = session?.agent;
    // The session's account is the one of the CLI the terminal was opened for, not of one started in it by hand.
    const account = agent && view?.kind === 'terminal' && view.node.provider === agent.kind ? (session.account ?? view.node.account) : undefined;
    return {
        asChat:
            kind === 'terminal' && agent && providers.some((entry) => entry.kind === agent.kind && entry.capabilities.chat)
                ? {
                      provider: agent.kind,
                      resume: agent.agentSessionId,
                      cwd: view?.kind === 'terminal' ? view.node.cwd : undefined,
                      ...(account === undefined ? {} : { account })
                  }
                : null,
        asTerminal:
            kind === 'chat' && chat?.agentSessionId
                ? { provider: chat.provider, resume: chat.agentSessionId, cwd: chat.cwd, ...(chat.account === undefined ? {} : { account: chat.account }) }
                : null
    };
};
