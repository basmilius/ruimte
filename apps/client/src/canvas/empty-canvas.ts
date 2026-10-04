import type { AgentKind, ProviderInfo, ProjectView } from '@ruimte/contracts';
import { isDiagramView, isDrawingView } from '@ruimte/contracts';
import { availableAgents } from '@/agents/creation';
import type { NodeKind } from '@/state/canvas';

/* One tile of the grid on an empty canvas, by what it does rather than by how it is drawn. */
export type EmptyCanvasTile =
    | { id: string; kind: 'agent'; target: 'terminal'; provider: AgentKind; name: string }
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
    hasFolder: boolean;
    layouts: readonly { name: string }[];
    views: readonly ProjectView[];
}

/* Chat providers have their own rows; the remaining choices become tiles below them. */
export function emptyCanvasSections({ providers, hasFolder, layouts, views }: EmptyCanvasInput): EmptyCanvasSections {
    const agents: EmptyCanvasTile[] = [
        ...availableAgents(providers, 'terminal').map((provider): EmptyCanvasTile => ({
            id: `agent-terminal-${provider.kind}`,
            kind: 'agent',
            target: 'terminal',
            provider: provider.kind,
            name: provider.name
        }))
    ];
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
}
