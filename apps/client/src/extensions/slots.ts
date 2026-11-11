import { useChats, type ChatStatuses } from '@adecore/agents-react/state';
import { isNodeAccent, type NodeAccent, type ProjectSummary, type ProjectView } from '@ruimte/contracts';
import type { LucideIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { agentInfoOf, type AgentInfo, type AgentSources } from '@/extensions/agent-info';
import { canvasOfNode, focusedCanvas, useCanvas, type CanvasNode, type CanvasState } from '@/state/canvas';
import { membersOf } from '@/state/canvas-model';
import { currentEndpointId, useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useContributions, type SlotEntry, type SlotName } from '@/state/extension-registry';
import { memoByIdentity } from '@/state/identity-memo';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSessions, type SessionsByKey } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';

export type { AgentInfo } from '@/extensions/agent-info';

export interface NodeInfo {
    id: string;
    kind: string;
    title: string;
    color: NodeAccent | null;
    bounds: { x: number; y: number; width: number; height: number };
    groupId: string | null;
    hidden: boolean;
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
interface NodeSources extends AgentSources {
    canvas: Pick<CanvasState, 'nodes' | 'edges' | 'viewId' | 'hidden'>;
}

/* What one node's info is made of, each piece only its own, so an info stays the same object while none of them changes. */
interface NodeParts {
    node: CanvasNode;
    group: CanvasNode | undefined;
    hidden: boolean;
    links: readonly string[];
    viewId: string;
    session: SessionsByKey[string] | undefined;
    chat: ChatStatuses[string] | undefined;
    snooze: number | undefined;
    endpointId: string;
}

// Every info handed out, so a slot can tell one in its context and read it again.
const issued = new WeakSet<object>();
const NO_LINKS: readonly string[] = [];
// The last info made for a node, with what it was made of.
const kept = new WeakMap<CanvasNode, { parts: NodeParts; info: NodeInfo }>();

/* Of nested groups that each hold a node, the innermost, for every node at once: found once per set of nodes, however many ask. */
const groupsOf = memoByIdentity((nodes: Readonly<Record<string, CanvasNode>>): ReadonlyMap<string, CanvasNode> => {
    const groups = new Map<string, CanvasNode>();
    const area = (node: CanvasNode): number => node.w * node.h;

    for (const group of Object.values(nodes).filter((each) => each.kind === 'group')) {
        for (const member of membersOf(group, nodes, {})) {
            const held = groups.get(member);

            if (member !== group.id && (held === undefined || area(group) < area(held))) {
                groups.set(member, group);
            }
        }
    }

    return groups;
});

/* The nodes each node has a line with, once each: two agents linked both ways are two edges, and one link. */
const linksOf = memoByIdentity((edges: CanvasState['edges']): ReadonlyMap<string, readonly string[]> => {
    const links = new Map<string, Set<string>>();
    const add = (from: string, to: string): void => {
        links.set(from, (links.get(from) ?? new Set()).add(to));
    };

    for (const edge of edges) {
        add(edge.from, edge.to);
        add(edge.to, edge.from);
    }

    return new Map([...links].map(([id, linked]) => [id, [...linked]]));
});

function sameParts(one: NodeParts, other: NodeParts): boolean {
    return (Object.keys(one) as (keyof NodeParts)[]).every((key) => one[key] === other[key]);
}

function infoOf(parts: NodeParts): NodeInfo {
    const before = kept.get(parts.node);

    if (before !== undefined && sameParts(before.parts, parts)) {
        return before.info;
    }

    const { node, group, endpointId } = parts;
    const key = endpointKey(endpointOfNode(node, endpointId), node.id);
    const raw = node.raw as { kind?: unknown; extension?: unknown; type?: unknown } | undefined;
    const agent = agentInfoOf(node, group, {
        sessions: parts.session === undefined ? {} : { [key]: parts.session },
        chats: parts.chat === undefined ? {} : { [key]: parts.chat },
        snoozes: parts.snooze === undefined ? {} : { [key]: parts.snooze },
        endpointId
    });
    const info: NodeInfo = {
        id: node.id,
        kind: raw?.kind === 'extension' ? 'extension' : node.kind,
        title: node.title,
        color: isNodeAccent(node.accent) ? node.accent : null,
        bounds: { x: node.x, y: node.y, width: node.w, height: node.h },
        groupId: group?.id ?? null,
        hidden: parts.hidden,
        viewId: parts.viewId,
        machine: node.machine ?? null,
        linkedTo: [...parts.links],
        ...(agent === undefined ? {} : { agent }),
        ...(node.path === undefined ? {} : { path: node.path }),
        ...(node.url === undefined ? {} : { url: node.url }),
        ...(typeof raw?.extension === 'string' && typeof raw.type === 'string' ? { extension: { id: raw.extension, type: raw.type } } : {})
    };

    kept.set(node, { parts, info });
    issued.add(info);

    return info;
}

function unknownInfo(id: string, viewId: string): NodeInfo {
    const info: NodeInfo = {
        id,
        kind: 'unknown',
        title: '',
        color: null,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        groupId: null,
        hidden: false,
        viewId,
        machine: null,
        linkedTo: []
    };

    issued.add(info);

    return info;
}

/*
 * One node's info for a render, which draws again only when that node, its group, its lines or its agent changed: a pet on
 * one node stays as it is while another node moves.
 */
export function useNodeInfo(id: string): NodeInfo {
    const node = useCanvas((state) => state.nodes[id]);
    const group = useCanvas((state) => groupsOf(state.nodes).get(id));
    const hidden = useCanvas((state) => state.hidden.has(id));
    const links = useCanvas((state) => linksOf(state.edges).get(id) ?? NO_LINKS);
    const viewId = useCanvas((state) => state.viewId ?? '');
    const endpointId = useEndpointId();
    const key = node === undefined ? null : endpointKey(endpointOfNode(node, endpointId), id);
    const session = useSessions((state) => (key === null ? undefined : state.byKey[key]));
    const chat = useChats((state) => (key === null ? undefined : state.statusByKey[key]));
    const snooze = useSnoozes((state) => (key === null ? undefined : state.byKey[key]));

    return node === undefined ? unknownInfo(id, viewId) : infoOf({ node, group, hidden, links, viewId, session, chat, snooze, endpointId });
}

/* A readable copy, so an extension never holds the store and the store stays ours to change. */
export function nodeInfoIn(sources: NodeSources, id: string): NodeInfo {
    const { canvas, endpointId } = sources;
    const node = canvas.nodes[id];
    const viewId = canvas.viewId ?? '';

    if (node === undefined) {
        return unknownInfo(id, viewId);
    }

    const key = endpointKey(endpointOfNode(node, endpointId), id);

    return infoOf({
        node,
        group: groupsOf(canvas.nodes).get(id),
        hidden: canvas.hidden.has(id),
        links: linksOf(canvas.edges).get(id) ?? NO_LINKS,
        viewId,
        session: sources.sessions[key],
        chat: sources.chats[key],
        snooze: sources.snoozes[key],
        endpointId
    });
}

/* The same, read from the stores as they are now, for code outside a render. */
export function nodeInfoOf(id: string): NodeInfo {
    const canvas = (canvasOfNode(id) ?? focusedCanvas()).getState();

    return nodeInfoIn(
        {
            canvas,
            sessions: useSessions.getState().byKey,
            chats: useChats.getState().statusByKey,
            snoozes: useSnoozes.getState().byKey,
            endpointId: currentEndpointId()
        },
        id
    );
}

/* Of nested groups that each hold the node, the innermost. */
export function groupOf(nodes: Readonly<Record<string, CanvasNode>>, id: string): CanvasNode | undefined {
    return groupsOf(nodes).get(id);
}

/* `null` while `active` is false, so a host with nothing to show subscribes to nothing that moves. */
export function useNodeSources(): NodeSources;
export function useNodeSources(active: boolean): NodeSources | null;
export function useNodeSources(active = true): NodeSources | null {
    const nodes = useCanvas((state) => (active ? state.nodes : null));
    const edges = useCanvas((state) => (active ? state.edges : null));
    const hidden = useCanvas((state) => state.hidden);
    const viewId = useCanvas((state) => state.viewId);
    const sessions = useSessions(useShallow((state) => (active ? state.byKey : null)));
    const chats = useChats(useShallow((state) => (active ? state.statusByKey : null)));
    const snoozes = useSnoozes((state) => (active ? state.byKey : null));
    const endpointId = useEndpointId();

    if (nodes === null || edges === null || sessions === null || chats === null || snoozes === null) {
        return null;
    }

    return { canvas: { nodes, edges, viewId, hidden }, sessions, chats, snoozes, endpointId };
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

function useBaseContext(): BaseContext {
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
