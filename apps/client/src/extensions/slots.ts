import { useChats, type ChatStatuses } from '@adecore/agents-react/state';
import { extensionAgentStatus, type ExtensionAgentStatus, type ProjectNode, type ProjectSummary, type ProjectView } from '@ruimte/contracts';
import type { LucideIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { canvasOfNode, focusedCanvas, useCanvas, type CanvasState } from '@/state/canvas';
import { membersOf } from '@/state/canvas-model';
import { currentEndpointId, useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useContributions, type SlotEntry, type SlotName } from '@/state/extension-registry';
import { useProject } from '@/state/project';
import { nodeProvider, nodeStatus, nodeWaitAsk, useSessions, type SessionsByKey } from '@/state/sessions';

export interface AgentInfo {
    provider: string;
    account: string | null;
    status: ExtensionAgentStatus;
    cwd: string | null;
    branch: string | null;
    worktree: string | null;
}

export interface NodeInfo {
    id: string;
    kind: string;
    title: string;
    color: string | null;
    bounds: { x: number; y: number; width: number; height: number };
    groupId: string | null;
    viewId: string;
    machine: string | null;
    linkedTo: string[];
    agent?: AgentInfo;
    path?: string;
    url?: string;
    extension?: { id: string; type: string };
}

export interface BaseContext {
    project: { id: string; name: string; folder: string | null };
    view: { id: string; kind: string; name: string } | null;
    machine: { id: string };
    theme: 'light' | 'dark';
}

/* What a node's info is read from. In a render each comes from a hook, so a compiled component never keeps an old one. */
export interface NodeSources {
    canvas: Pick<CanvasState, 'nodes' | 'edges' | 'viewId'>;
    sessions: SessionsByKey;
    chats: ChatStatuses;
    endpointId: string;
}

// Every info handed out, so a slot can tell one in its context and read it again.
const issued = new WeakSet<object>();

function agentOf(node: ProjectNode, group: ProjectNode | undefined, sources: NodeSources): AgentInfo | undefined {
    if (node.kind !== 'terminal' && node.kind !== 'chat' && node.kind !== 'design') {
        return undefined;
    }

    const { sessions, chats, endpointId } = sources;
    const status = nodeStatus(node, sessions, chats, endpointId);
    const needsYou = nodeWaitAsk(node, sessions, chats, endpointId) !== null;

    return {
        // A chat opened on the default stores no CLI; its thread says which one it runs on.
        provider: nodeProvider(node, chats, endpointId) ?? 'claude',
        account: node.account ?? null,
        status: extensionAgentStatus(status, needsYou),
        cwd: node.cwd ?? group?.worktree?.path ?? null,
        branch: group?.worktree?.branch ?? null,
        worktree: group?.worktree?.path ?? null
    };
}

/* A readable copy, so an extension never holds the store and the store stays ours to change. */
export function nodeInfoIn(sources: NodeSources, id: string): NodeInfo {
    const info = readNodeInfo(sources, id);

    issued.add(info);

    return info;
}

/* The same, read from the stores as they are now, for code outside a render. */
export function nodeInfoOf(id: string): NodeInfo {
    const canvas = (canvasOfNode(id) ?? focusedCanvas()).getState();

    return nodeInfoIn({ canvas, sessions: useSessions.getState().byKey, chats: useChats.getState().statusByKey, endpointId: currentEndpointId() }, id);
}

/* `null` while `active` is false, so a host with nothing to show subscribes to nothing that moves. */
export function useNodeSources(): NodeSources;
export function useNodeSources(active: boolean): NodeSources | null;
export function useNodeSources(active = true): NodeSources | null {
    const nodes = useCanvas((state) => (active ? state.nodes : null));
    const edges = useCanvas((state) => (active ? state.edges : null));
    const viewId = useCanvas((state) => state.viewId);
    const sessions = useSessions(useShallow((state) => (active ? state.byKey : null)));
    const chats = useChats(useShallow((state) => (active ? state.statusByKey : null)));
    const endpointId = useEndpointId();

    if (nodes === null || edges === null || sessions === null || chats === null) {
        return null;
    }

    return { canvas: { nodes, edges, viewId }, sessions, chats, endpointId };
}

function readNodeInfo(sources: NodeSources, id: string): NodeInfo {
    const { canvas } = sources;
    const node = canvas.nodes[id];

    if (node === undefined) {
        return {
            id,
            kind: 'unknown',
            title: '',
            color: null,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            groupId: null,
            viewId: canvas.viewId ?? '',
            machine: null,
            linkedTo: []
        };
    }

    // Of nested groups that each hold it, the innermost.
    const group = Object.values(canvas.nodes)
        .filter((each) => each.kind === 'group' && each.id !== id && membersOf(each, canvas.nodes, {}).includes(id))
        .sort((one, other) => one.w * one.h - other.w * other.h)[0];
    const raw = node.raw as { kind?: unknown; extension?: unknown; type?: unknown } | undefined;
    const agent = agentOf(node, group, sources);

    return {
        id,
        kind: raw?.kind === 'extension' ? 'extension' : node.kind,
        title: node.title,
        color: node.accent ?? null,
        bounds: { x: node.x, y: node.y, width: node.w, height: node.h },
        groupId: group?.id ?? null,
        viewId: canvas.viewId ?? '',
        machine: node.machine ?? null,
        // Two agents linked both ways are two edges, and one link.
        linkedTo: [...new Set(canvas.edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : [])))],
        ...(agent === undefined ? {} : { agent }),
        ...(node.path === undefined ? {} : { path: node.path }),
        ...(node.url === undefined ? {} : { url: node.url }),
        ...(typeof raw?.extension === 'string' && typeof raw.type === 'string' ? { extension: { id: raw.extension, type: raw.type } } : {})
    };
}

function contextOf(
    current: ProjectSummary | null,
    views: readonly ProjectView[],
    activeViewId: string | null,
    endpointId: string,
    theme: BaseContext['theme']
): BaseContext {
    const view = views.find((each) => each.id === activeViewId);

    return {
        project: { id: current?.projectId ?? '', name: current?.name ?? '', folder: current?.folder ?? null },
        view: view === undefined ? null : { id: view.id, kind: view.kind, name: view.name ?? '' },
        machine: { id: endpointId },
        theme
    };
}

// Read off the page, since the theme's store reaches for a document as it loads, and this module loads without one in tests.
function pageTheme(): BaseContext['theme'] {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function followPageTheme(listener: () => void): () => void {
    const observer = new MutationObserver(listener);

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
}

/* For code outside a render, such as a shortcut or a command. */
export function baseContext(): BaseContext {
    const { views, activeViewId } = useDocument.getState();

    return contextOf(useProject.getState().current, views, activeViewId, currentEndpointId(), pageTheme());
}

export function useBaseContext(): BaseContext {
    const current = useProject((state) => state.current);
    const views = useDocument((state) => state.views);
    const activeViewId = useDocument((state) => state.activeViewId);
    const endpointId = useEndpointId();
    const theme = useSyncExternalStore(followPageTheme, pageTheme);

    return contextOf(current, views, activeViewId, endpointId, theme);
}

/* A node's info in a context came from whoever drew the host, perhaps a render ago; this reads it again. */
function withCurrentNodes(context: object, sources: NodeSources): object {
    const current = (value: unknown): unknown => {
        if (Array.isArray(value)) {
            return value.map(current);
        }

        if (typeof value !== 'object' || value === null || !issued.has(value)) {
            return value;
        }

        const { id } = value as NodeInfo;

        // A node on another canvas than this host's, such as a row in the sidebar.
        return sources.canvas.nodes[id] === undefined ? nodeInfoOf(id) : nodeInfoIn(sources, id);
    };

    return Object.fromEntries(Object.entries(context).map(([key, value]) => [key, current(value)]));
}

export interface SlotAnswer {
    title?: string;
    icon?: LucideIcon;
    disabled?: boolean | string;
    badge?: string;
    order?: number;
}

export interface ResolvedEntry {
    entry: SlotEntry;
    title: string;
    icon: LucideIcon | undefined;
    disabled: boolean;
    disabledReason: string | undefined;
    badge: string | undefined;
    order: number;
}

/* Asks every entry at this place, and leaves out one that fails: a throw in someone's slot must not cost the menu it sits in. */
export function resolveSlot(entries: readonly SlotEntry[], place: SlotName, context: object): ResolvedEntry[] {
    return entries
        .flatMap((entry) => {
            const slot = entry.slots[place];

            if (slot === undefined) {
                return [];
            }

            try {
                const answer = slot === true ? true : slot(context);

                if (answer === false) {
                    return [];
                }

                const details: SlotAnswer = answer === true ? {} : answer;
                const { disabled } = details;

                return [
                    {
                        entry,
                        title: details.title ?? entry.title,
                        icon: details.icon ?? entry.icon,
                        disabled: disabled !== undefined && disabled !== false,
                        disabledReason: typeof disabled === 'string' ? disabled : undefined,
                        badge: details.badge,
                        order: details.order ?? 0
                    }
                ];
            } catch (e) {
                entry.onFailure?.(e instanceof Error ? e.message : String(e));

                return [];
            }
        })
        .toSorted((left, right) => left.order - right.order);
}

/*
 * What an extension shows at this place. It redraws when a status changes, since a slot may ask for one, and
 * the keys of those stores are read through here so a host that never has an entry pays for nothing else.
 */
export function useSlot(place: SlotName, context: object): { resolved: ResolvedEntry[]; full: object } {
    const entries = useContributions((state) => state.slotEntries);
    const here = entries.filter((entry) => entry.slots[place] !== undefined);
    const sources = useNodeSources(here.length > 0);
    const base = useBaseContext();

    if (sources === null) {
        return { resolved: [], full: context };
    }

    const full = { ...base, ...withCurrentNodes(context, sources) };

    return { resolved: resolveSlot(here, place, full), full };
}
