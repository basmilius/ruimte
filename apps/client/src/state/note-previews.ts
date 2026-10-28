import { create } from 'zustand';
import { z } from 'zod';
import { useCurrentProjectKey } from '@/state/view-pins';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { storedJson } from '@/state/stored-json';

/*
 * The notes a person locked to their rendered markdown, per project. How one person likes to read a
 * note is theirs, like the camera, so it stays in this client's storage and never in a project file.
 */
const NOTE_PREVIEWS_STORAGE_KEY = 'ruimte.canvas.notePreviews';

const storedPreviews = storedJson(
    NOTE_PREVIEWS_STORAGE_KEY,
    z
        .record(z.string(), z.array(z.unknown()))
        .transform((projects) =>
            Object.fromEntries(Object.entries(projects).map(([key, ids]) => [key, ids.filter((id): id is string => typeof id === 'string')]))
        )
);

interface NotePreviewsState {
    /* By `endpointKey(endpointId, projectId)`. */
    locked: Record<string, string[]>;
    setLocked(projectKey: string, nodeId: string, locked: boolean): void;
}

export const useNotePreviews = create<NotePreviewsState>((set) => ({
    locked: storedPreviews.read() ?? {},
    setLocked(projectKey, nodeId, locked) {
        set((state) => {
            // Another window writes the same key for its own project, so the rest is read again rather than taken from this page.
            const current = storedPreviews.read() ?? state.locked;
            const before = current[projectKey] ?? [];

            if (before.includes(nodeId) === locked) {
                return state;
            }

            const after = locked ? [...before, nodeId] : before.filter((id) => id !== nodeId);
            const { [projectKey]: _was, ...rest } = current;
            const next = after.length === 0 ? rest : { ...rest, [projectKey]: after };
            storedPreviews.write(next);

            return { locked: next };
        });
    }
}));

function currentProjectKey(): string | null {
    const { current, currentEndpointId } = useProject.getState();

    return current === null || currentEndpointId === null ? null : endpointKey(currentEndpointId, current.projectId);
}

export function isNotePreviewLocked(nodeId: string): boolean {
    const key = currentProjectKey();

    return key !== null && (useNotePreviews.getState().locked[key]?.includes(nodeId) ?? false);
}

export function setNotePreviewLocked(nodeId: string, locked: boolean): void {
    const key = currentProjectKey();

    if (key !== null) {
        useNotePreviews.getState().setLocked(key, nodeId, locked);
    }
}

export function useNotePreviewLocked(nodeId: string): boolean {
    const key = useCurrentProjectKey();

    return useNotePreviews((s) => key !== null && (s.locked[key]?.includes(nodeId) ?? false));
}
