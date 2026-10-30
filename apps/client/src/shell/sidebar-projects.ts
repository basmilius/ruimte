import { useEffect, useState } from 'react';
import { create, createStore, useStore, type StoreApi } from 'zustand';
import { z } from 'zod';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { followOtherWindows } from '@/state/other-windows';
import { storedJson } from '@/state/stored-json';
import { machineTransport, pool } from '@/transport';
import { SidebarWatch, type SidebarMachineSnapshot } from './sidebar-watch';

export function sidebarProjectKey(endpointId: string, projectId: string): string {
    return JSON.stringify([endpointId, projectId]);
}

const stringList = z.array(z.unknown()).transform((items) => items.filter((item): item is string => typeof item === 'string'));

const SIDEBAR_PROJECTS_STORAGE_KEY = 'ruimte.sidebar.projects';
const storedCollapsed = storedJson(SIDEBAR_PROJECTS_STORAGE_KEY, stringList);

function readCollapsed(): string[] {
    return storedCollapsed.read() ?? [];
}

/*
 * The order of the projects in "All open projects", per client like which ones are folded. A project
 * that closes keeps its key here, so it comes back in its old place when it opens again.
 */
export const SIDEBAR_ORDER_STORAGE_KEY = 'ruimte.sidebar.order';
const storedOrder = storedJson(SIDEBAR_ORDER_STORAGE_KEY, stringList);

function readOrder(): string[] {
    return storedOrder.read() ?? [];
}

/* A line between the projects of "All open projects", with a heading on it once it has a label. */
export interface SidebarSeparator {
    id: string;
    /* Empty for a bare line. */
    label: string;
    /* A heading that hides the projects under it, up to the next separator. */
    folded: boolean;
}

/* Its place is a key in the order beside the projects', which no project key (a JSON array) can be. */
export function separatorKey(id: string): string {
    return `separator:${id}`;
}

export const SIDEBAR_SEPARATORS_STORAGE_KEY = 'ruimte.sidebar.separators';
const storedSeparators = storedJson(
    SIDEBAR_SEPARATORS_STORAGE_KEY,
    z.array(z.unknown()).transform((items) =>
        items.flatMap((item) => {
            const parsed = z.object({ id: z.string(), label: z.string(), folded: z.boolean().optional() }).safeParse(item);
            return parsed.success ? [{ ...parsed.data, folded: parsed.data.folded ?? false }] : [];
        })
    )
);

function readSeparators(): SidebarSeparator[] {
    return storedSeparators.read() ?? [];
}

/*
 * `stored` with `key` moved to `index` among the keys on screen (`visible`, in the order they show). The
 * keys of projects not on screen keep their place among the rest, so each comes back where it was.
 */
export function moveInOrder(stored: readonly string[], visible: readonly string[], key: string, index: number): string[] {
    const others = visible.filter((one) => one !== key);
    const to = Math.max(0, Math.min(index, others.length));
    const rest = stored.filter((one) => one !== key);
    if (others.length === 0) {
        return [key, ...rest];
    }
    if (to < others.length) {
        const before = rest.indexOf(others[to]!);
        return before === -1 ? [...rest, key] : [...rest.slice(0, before), key, ...rest.slice(before)];
    }
    const after = rest.indexOf(others[others.length - 1]!);
    return after === -1 ? [...rest, key] : [...rest.slice(0, after + 1), key, ...rest.slice(after + 1)];
}

/* Where the separators show: each before the first project on screen that follows it in `order`, the rest after the last one. */
export interface SeparatorPlaces {
    before: Record<string, SidebarSeparator[]>;
    trailing: SidebarSeparator[];
}

export function placeSeparators(order: readonly string[], onScreen: readonly string[], separators: readonly SidebarSeparator[]): SeparatorPlaces {
    const byKey = new Map(separators.map((separator) => [separatorKey(separator.id), separator]));
    const shown = new Set(onScreen);
    const before: Record<string, SidebarSeparator[]> = {};
    let pending: SidebarSeparator[] = [];
    for (const key of order) {
        const separator = byKey.get(key);
        if (separator) {
            pending.push(separator);
        } else if (shown.has(key)) {
            if (pending.length > 0) {
                before[key] = pending;
            }
            pending = [];
        }
    }
    return { before, trailing: pending };
}

/* Projects and separators in the order they show, which is what a move counts places in. */
export function movableKeys(projects: readonly string[], places: SeparatorPlaces): string[] {
    return [
        ...projects.flatMap((key) => [...(places.before[key] ?? []).map((separator) => separatorKey(separator.id)), key]),
        ...places.trailing.map((separator) => separatorKey(separator.id))
    ];
}

/* The projects a folded heading hides, from the keys in the order they show. */
export function foldedProjects(movable: readonly string[], separators: readonly SidebarSeparator[]): Set<string> {
    const folded = new Set(separators.filter((separator) => separator.folded && separator.label !== '').map((separator) => separatorKey(separator.id)));
    const hidden = new Set<string>();
    let hiding = false;
    for (const key of movable) {
        if (key.startsWith('separator:')) {
            hiding = folded.has(key);
        } else if (hiding) {
            hidden.add(key);
        }
    }
    return hidden;
}

export const useSidebarProjects = create<{
    order: string[];
    collapsed: string[];
    expandedViews: Record<string, string[]>;
    collapse(key: string, collapsed: boolean): void;
    expandView(key: string, viewId: string, expanded: boolean): void;
    separators: SidebarSeparator[];
    /* The separator whose label is being typed, which only the window that added or renamed it shows. */
    renamingSeparatorId: string | null;
    /* The project whose New view menu opens once the window switched to it. */
    newViewFor: string | null;
    setOrder(order: string[]): void;
    /* Moves a project or separator to `index` among the ones on screen, which `visible` names in their order. */
    move(visible: readonly string[], key: string, index: number): void;
    /* A new separator at `index` among the ones on screen, with its label field open. */
    addSeparator(visible: readonly string[], index: number): void;
    foldSeparator(id: string, folded: boolean): void;
    renameSeparator(id: string, label: string): void;
    removeSeparator(id: string): void;
    setRenamingSeparator(id: string | null): void;
    askNewView(key: string | null): void;
    /* Folds and orders the projects the way another window left them. */
    reload(): void;
}>((set, get) => {
    const saveSeparators = (separators: SidebarSeparator[]): void => {
        storedSeparators.write(separators);
        set({ separators });
    };
    return {
        order: readOrder(),
        collapsed: readCollapsed(),
        expandedViews: {},
        separators: readSeparators(),
        renamingSeparatorId: null,
        newViewFor: null,
        collapse(key, collapsed) {
            set((state) => {
                const next = collapsed ? [...new Set([...state.collapsed, key])] : state.collapsed.filter((id) => id !== key);
                storedCollapsed.write(next);
                return { collapsed: next };
            });
        },
        expandView(key, viewId, expanded) {
            set((state) => {
                const before = state.expandedViews[key] ?? [];
                return {
                    expandedViews: { ...state.expandedViews, [key]: expanded ? [...new Set([...before, viewId])] : before.filter((id) => id !== viewId) }
                };
            });
        },
        setOrder(order) {
            storedOrder.write(order);
            set({ order });
        },
        move(visible, key, index) {
            get().setOrder(moveInOrder(get().order, visible, key, index));
        },
        addSeparator(visible, index) {
            const separator = { id: crypto.randomUUID(), label: '', folded: false };
            saveSeparators([...get().separators, separator]);
            set({ renamingSeparatorId: separator.id });
            get().setOrder(moveInOrder(get().order, visible, separatorKey(separator.id), index));
        },
        foldSeparator(id, folded) {
            saveSeparators(get().separators.map((separator) => (separator.id === id ? { ...separator, folded } : separator)));
        },
        renameSeparator(id, label) {
            saveSeparators(get().separators.map((separator) => (separator.id === id ? { ...separator, label } : separator)));
        },
        removeSeparator(id) {
            saveSeparators(get().separators.filter((separator) => separator.id !== id));
            get().setOrder(get().order.filter((key) => key !== separatorKey(id)));
        },
        setRenamingSeparator(id) {
            set({ renamingSeparatorId: id });
        },
        askNewView(key) {
            set({ newViewFor: key });
        },
        reload() {
            set({ collapsed: readCollapsed(), order: readOrder(), separators: readSeparators() });
        }
    };
});

// Loaded with the sidebar, which only a workspace draws, so the start screen does not listen for it.
for (const key of [SIDEBAR_PROJECTS_STORAGE_KEY, SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SEPARATORS_STORAGE_KEY]) {
    followOtherWindows(key, () => useSidebarProjects.getState().reload());
}

export function useSidebarMachines(enabled: boolean, endpointIds: readonly string[], holdsLink = true): Record<string, SidebarMachineSnapshot> {
    const ids = [...endpointIds].sort().join('\0');
    const [store] = useState(() => createStore<{ snapshots: Record<string, SidebarMachineSnapshot> }>(() => ({ snapshots: {} })));
    // Kept per machine across changes of the set, so a machine joining the sidebar does not make every other one ask again.
    const [watched] = useState(() => new Map<string, () => void>());
    const snapshots = useStore(store, (state) => state.snapshots);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        return () => {
            watched.forEach((stop) => stop());
            watched.clear();
            store.setState({ snapshots: {} });
        };
    }, [enabled, holdsLink, store, watched]);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        const wanted = new Set(ids.split('\0'));
        for (const [endpointId, stop] of [...watched]) {
            if (!wanted.has(endpointId)) {
                stop();
                watched.delete(endpointId);
                store.setState((before) => ({ snapshots: Object.fromEntries(Object.entries(before.snapshots).filter(([id]) => id !== endpointId)) }));
            }
        }
        for (const endpoint of listedEndpoints(useEndpoints.getState().endpoints)) {
            if (wanted.has(endpoint.id) && !watched.has(endpoint.id)) {
                watched.set(endpoint.id, watchMachine(endpoint, store, holdsLink));
            }
        }
    }, [enabled, ids, holdsLink, store, watched]);
    return snapshots;
}

const machineWatches = new Map<string, { watcher: SidebarWatch; release: (() => void) | null; readers: number; holders: number }>();

/* Reading what the tabs already observe starts neither a watcher nor a machine link. */
export function sidebarMachineSnapshot(endpointId: string): SidebarMachineSnapshot | null {
    return machineWatches.get(endpointId)?.watcher.getSnapshot() ?? null;
}

/* Tab badges only observe an existing link; the all-project sidebar keeps its existing hold. Both read one watcher. */
function watchMachine(endpoint: Endpoint, store: StoreApi<{ snapshots: Record<string, SidebarMachineSnapshot> }>, holdsLink: boolean): () => void {
    let shared = machineWatches.get(endpoint.id);

    if (shared === undefined) {
        shared = { watcher: new SidebarWatch(machineTransport(endpoint.id)), release: null, readers: 0, holders: 0 };
        machineWatches.set(endpoint.id, shared);
    }

    const held = shared;
    const { watcher } = held;
    held.readers++;

    if (holdsLink && held.holders++ === 0) {
        held.release = pool.hold(endpoint);
    }

    const show = (): void => store.setState((before) => ({ snapshots: { ...before.snapshots, [endpoint.id]: watcher.getSnapshot() } }));
    const off = watcher.subscribe(show);
    show();

    return () => {
        off();
        held.readers--;

        if (holdsLink && --held.holders === 0) {
            held.release?.();
            held.release = null;
        }

        if (held.readers === 0) {
            watcher.dispose();
            machineWatches.delete(endpoint.id);
        }
    };
}
