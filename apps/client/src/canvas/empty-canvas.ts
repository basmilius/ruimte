import type { AgentKind, ProviderInfo, ProjectView } from '@ruimte/contracts';
import { isDiagramView, isDrawingView } from '@ruimte/contracts';
import type { NodeKind } from '@/state/canvas';

/* One tile of the grid on an empty canvas, by what it does rather than by how it is drawn. */
export type EmptyCanvasTile =
    | { id: string; kind: 'agent'; target: 'chat' | 'terminal'; provider: AgentKind; name: string }
    | { id: 'agents-connecting'; kind: 'connecting' }
    | { id: 'agents-setup'; kind: 'setup' }
    | { id: string; kind: 'node'; node: Extract<NodeKind, 'chat' | 'terminal' | 'browser' | 'note' | 'group'> }
    | { id: 'file'; kind: 'file' }
    | { id: 'text'; kind: 'text' }
    | { id: string; kind: 'layout'; name: string }
    | { id: string; kind: 'view'; viewId: string; name: string; view: 'drawing' | 'diagram' };

export interface EmptyCanvasSections {
    agents: EmptyCanvasTile[];
    place: EmptyCanvasTile[];
    project: EmptyCanvasTile[];
}

export interface EmptyCanvasInput {
    providers: readonly ProviderInfo[];
    /* The machine answered with its CLIs; before that nothing can be said about them. */
    loaded: boolean;
    hasFolder: boolean;
    layouts: readonly { name: string }[];
    views: readonly ProjectView[];
}

/*
 * Only what does something here: an agent the machine has installed, a file with a folder to pick it
 * from, a layout the canvas has, a drawing or a diagram the project has. A machine without any agent
 * gets the one tile that goes to where agents are set up.
 */
export const emptyCanvasSections = ({ providers, loaded, hasFolder, layouts, views }: EmptyCanvasInput): EmptyCanvasSections => {
    const installed = providers.filter((provider) => provider.installed);
    const agents: EmptyCanvasTile[] = [
        ...installed
            .filter((provider) => provider.capabilities.chat)
            .map((provider): EmptyCanvasTile => ({
                id: `agent-chat-${provider.kind}`,
                kind: 'agent',
                target: 'chat',
                provider: provider.kind,
                name: provider.name
            })),
        ...installed
            .filter((provider) => provider.capabilities.terminal)
            .map((provider): EmptyCanvasTile => ({
                id: `agent-terminal-${provider.kind}`,
                kind: 'agent',
                target: 'terminal',
                provider: provider.kind,
                name: provider.name
            }))
    ];
    if (agents.length === 0) {
        agents.push(loaded ? { id: 'agents-setup', kind: 'setup' } : { id: 'agents-connecting', kind: 'connecting' });
    }
    agents.push({ id: 'node-chat', kind: 'node', node: 'chat' });

    const place: EmptyCanvasTile[] = [
        { id: 'node-terminal', kind: 'node', node: 'terminal' },
        { id: 'node-browser', kind: 'node', node: 'browser' },
        ...(hasFolder ? [{ id: 'file', kind: 'file' } as const] : []),
        { id: 'node-note', kind: 'node', node: 'note' },
        { id: 'node-group', kind: 'node', node: 'group' },
        { id: 'text', kind: 'text' }
    ];

    const project: EmptyCanvasTile[] = [
        ...layouts.map((layout): EmptyCanvasTile => ({ id: `layout-${layout.name}`, kind: 'layout', name: layout.name })),
        ...views.flatMap((view): EmptyCanvasTile[] =>
            isDrawingView(view) || isDiagramView(view) ? [{ id: `view-${view.id}`, kind: 'view', viewId: view.id, name: view.name ?? '', view: view.kind }] : []
        )
    ];
    return { agents, place, project };
};

/* Below this a cell draws a row of icons, and below the second only the sentence: the size of the cell counts, not the window's. */
export const COMPACT_BELOW = { w: 640, h: 460 };
export const MINIMAL_BELOW = { w: 300, h: 180 };

export type EmptyCanvasSize = 'full' | 'compact' | 'minimal';

export const emptyCanvasSize = (viewport: { w: number; h: number }): EmptyCanvasSize => {
    if (viewport.w < MINIMAL_BELOW.w || viewport.h < MINIMAL_BELOW.h) {
        return 'minimal';
    }
    return viewport.w < COMPACT_BELOW.w || viewport.h < COMPACT_BELOW.h ? 'compact' : 'full';
};
