import { useEffect, useState } from 'react';
import { create, createStore, useStore } from 'zustand';
import { useEndpoints } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { followOtherWindows } from '@/state/other-windows';
import { machineTransport, pool } from '@/transport';
import { SidebarWatch, type SidebarMachineSnapshot } from './sidebar-watch';

export const sidebarProjectKey = (endpointId: string, projectId: string): string => JSON.stringify([endpointId, projectId]);

export const SIDEBAR_PROJECTS_STORAGE_KEY = 'ruimte.sidebar.projects';
const readCollapsed = (): string[] => {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(SIDEBAR_PROJECTS_STORAGE_KEY) ?? '[]');
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
};

export const useSidebarProjects = create<{
    order: string[];
    collapsed: string[];
    expandedViews: Record<string, string[]>;
    collapse(key: string, collapsed: boolean): void;
    expandView(key: string, viewId: string, expanded: boolean): void;
    /* Folds the projects the way another window left them. */
    reload(): void;
}>((set) => ({
    order: [],
    collapsed: readCollapsed(),
    expandedViews: {},
    collapse(key, collapsed) {
        set((state) => {
            const next = collapsed ? [...new Set([...state.collapsed, key])] : state.collapsed.filter((id) => id !== key);
            try {
                localStorage.setItem(SIDEBAR_PROJECTS_STORAGE_KEY, JSON.stringify(next));
            } catch {
                /* Storage may be unavailable in private browsing. */
            }
            return { collapsed: next };
        });
    },
    expandView(key, viewId, expanded) {
        set((state) => {
            const before = state.expandedViews[key] ?? [];
            return { expandedViews: { ...state.expandedViews, [key]: expanded ? [...new Set([...before, viewId])] : before.filter((id) => id !== viewId) } };
        });
    },
    reload() {
        set({ collapsed: readCollapsed() });
    }
}));

// Loaded with the sidebar, which only a workspace draws, so the start screen does not listen for it.
followOtherWindows(SIDEBAR_PROJECTS_STORAGE_KEY, () => useSidebarProjects.getState().reload());

export const useSidebarMachines = (enabled: boolean, endpointIds: readonly string[]): Record<string, SidebarMachineSnapshot> => {
    const ids = [...endpointIds].sort().join('\0');
    const [store] = useState(() => createStore<{ snapshots: Record<string, SidebarMachineSnapshot> }>(() => ({ snapshots: {} })));
    const snapshots = useStore(store, (state) => state.snapshots);
    useEffect(() => {
        if (!enabled) {
            store.setState({ snapshots: {} });
            return;
        }
        let alive = true;
        const disposers = listedEndpoints(useEndpoints.getState().endpoints)
            .filter((endpoint) => ids.split('\0').includes(endpoint.id))
            .map((endpoint) => {
                const watcher = new SidebarWatch(machineTransport(endpoint.id));
                const off = watcher.subscribe(() => {
                    if (alive) {
                        store.setState((before) => ({ snapshots: { ...before.snapshots, [endpoint.id]: watcher.getSnapshot() } }));
                    }
                });
                store.setState((before) => ({ snapshots: { ...before.snapshots, [endpoint.id]: watcher.getSnapshot() } }));
                const release = pool.hold(endpoint);
                return () => {
                    off();
                    watcher.dispose();
                    release();
                };
            });
        return () => {
            alive = false;
            disposers.forEach((dispose) => dispose());
        };
    }, [enabled, ids, store]);
    return snapshots;
};
