import { create } from 'zustand';
import { z } from 'zod';
import { endpointKey } from '@/state/keys';
import { useProject, type ProjectState } from '@/state/project';
import { storedJson } from '@/state/stored-json';

/*
 * The views of the project a person pinned in a tab host, per project. Kept in this client's storage
 * and not in the project's local file, since a field written there would be a new stored field, which
 * an older release drops. A loose tab keeps its pin in the pool (`state/files.ts`).
 */
export const VIEW_PINS_STORAGE_KEY = 'ruimte.tabs.pinnedViews';

const storedPins = storedJson(
    VIEW_PINS_STORAGE_KEY,
    z
        .record(z.string(), z.array(z.unknown()))
        .transform((projects) =>
            Object.fromEntries(Object.entries(projects).map(([key, ids]) => [key, ids.filter((id): id is string => typeof id === 'string')]))
        )
);

interface ViewPinsState {
    /* By `endpointKey(endpointId, projectId)`. */
    pins: Record<string, string[]>;
    setPinned(projectKey: string, viewId: string, pinned: boolean): void;
}

export const useViewPins = create<ViewPinsState>((set) => ({
    pins: storedPins.read() ?? {},
    setPinned(projectKey, viewId, pinned) {
        set((state) => {
            const before = state.pins[projectKey] ?? [];
            if (before.includes(viewId) === pinned) {
                return state;
            }
            const after = pinned ? [...before, viewId] : before.filter((id) => id !== viewId);
            const { [projectKey]: _was, ...rest } = state.pins;
            const pins = after.length === 0 ? rest : { ...rest, [projectKey]: after };
            storedPins.write(pins);
            return { pins };
        });
    }
}));

/* The project on screen, as the key its pins are under; null on the start screen. */
export function currentProjectKey(): string | null {
    return projectKeyOf(useProject.getState());
}

/* The same key for a render, which redraws when the project on screen changes. */
export function useCurrentProjectKey(): string | null {
    return useProject(projectKeyOf);
}

function projectKeyOf({ current, currentEndpointId }: Pick<ProjectState, 'current' | 'currentEndpointId'>): string | null {
    return current === null || currentEndpointId === null ? null : endpointKey(currentEndpointId, current.projectId);
}

export function isViewPinned(viewId: string): boolean {
    const key = currentProjectKey();
    return key !== null && (useViewPins.getState().pins[key]?.includes(viewId) ?? false);
}

export function setViewPinned(viewId: string, pinned: boolean): void {
    const key = currentProjectKey();
    if (key !== null) {
        useViewPins.getState().setPinned(key, viewId, pinned);
    }
}

export function useViewPinned(viewId: string): boolean {
    const key = useCurrentProjectKey();
    return useViewPins((s) => key !== null && (s.pins[key]?.includes(viewId) ?? false));
}
