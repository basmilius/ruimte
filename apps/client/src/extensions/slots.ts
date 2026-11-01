import { useChats } from '@adecore/agents-react/state';
import type { LucideIcon } from 'lucide-react';
import type { ProjectNode } from '@ruimte/contracts';
import { useShallow } from 'zustand/react/shallow';
import { useContributions, type SlotEntry, type SlotName } from '@/extensions/registry';
import { canvasOfNode, focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { nodeStatus, nodeWaitAsk, useSessions } from '@/state/sessions';

export interface AgentInfo {
    provider: string;
    account: string | null;
    status: 'idle' | 'running' | 'needsYou' | 'stopped';
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

function agentOf(node: ProjectNode, group: ProjectNode | undefined): AgentInfo | undefined {
    if (node.kind !== 'terminal' && node.kind !== 'chat' && node.kind !== 'design') {
        return undefined;
    }

    const endpointId = currentEndpointId();
    const sessions = useSessions.getState().byKey;
    const chats = useChats.getState().byKey;
    const status = nodeStatus(node, sessions, chats, endpointId);
    const needsYou = nodeWaitAsk(node, sessions, chats, endpointId) !== null;

    return {
        provider: node.provider ?? 'claude',
        account: node.account ?? null,
        status: needsYou ? 'needsYou' : status === 'running' ? 'running' : status === undefined ? 'stopped' : 'idle',
        cwd: node.cwd ?? group?.worktree?.path ?? null,
        branch: group?.worktree?.branch ?? null,
        worktree: group?.worktree?.path ?? null
    };
}

/* A readable copy, so an extension never holds the store and the store stays ours to change. */
export function nodeInfoOf(id: string): NodeInfo {
    const store = canvasOfNode(id) ?? focusedCanvas();
    const canvas = store.getState();
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

    const group = Object.values(canvas.nodes).find((each) => each.kind === 'group' && each.memberIds?.includes(id));
    const raw = node.raw as { kind?: unknown; extension?: unknown; type?: unknown } | undefined;
    const agent = agentOf(node, group);

    return {
        id,
        kind: raw?.kind === 'extension' ? 'extension' : node.kind,
        title: node.title,
        color: node.accent ?? null,
        bounds: { x: node.x, y: node.y, width: node.w, height: node.h },
        groupId: group?.id ?? null,
        viewId: canvas.viewId ?? '',
        machine: node.machine ?? null,
        linkedTo: canvas.edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : [])),
        ...(agent === undefined ? {} : { agent }),
        ...(node.path === undefined ? {} : { path: node.path }),
        ...(node.url === undefined ? {} : { url: node.url }),
        ...(typeof raw?.extension === 'string' && typeof raw.type === 'string' ? { extension: { id: raw.extension, type: raw.type } } : {})
    };
}

export function baseContext(): BaseContext {
    const { current } = useProject.getState();
    const { views, activeViewId } = useDocument.getState();
    const view = views.find((each) => each.id === activeViewId);

    return {
        project: { id: current?.projectId ?? '', name: current?.name ?? '', folder: current?.folder ?? null },
        view: view === undefined ? null : { id: view.id, kind: view.kind, name: view.name ?? '' },
        machine: { id: currentEndpointId() },
        // Read off the page, since the theme's store takes a document just to load.
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    };
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

    useSessions(useShallow((state) => (here.length === 0 ? null : state.byKey)));
    useChats(useShallow((state) => (here.length === 0 ? null : state.byKey)));
    useEndpointId();

    if (here.length === 0) {
        return { resolved: [], full: context };
    }

    const full = { ...baseContext(), ...context };

    return { resolved: resolveSlot(here, place, full), full };
}
