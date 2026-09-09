import { create } from 'zustand';
import type { ProjectDocument, ProjectSummary } from '@ruimte/contracts';

interface ProjectStore {
    projects: ProjectSummary[];
    current: ProjectSummary | null;
    /* The rev the canvas on screen came from; every save names it. */
    rev: number;
    /* Edits since the last save reached the daemon. */
    dirty: boolean;
    /* What the file holds now, when it changed on disk while there were unsaved edits. */
    conflict: ProjectDocument | null;
    /* Why the last save or open failed, for the banner. */
    error: string | null;
    setProjects(projects: ProjectSummary[]): void;
    setCurrent(current: ProjectSummary | null, rev: number): void;
    setRev(rev: number): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: ProjectDocument | null): void;
    setError(error: string | null): void;
}

/* Which project is on the canvas and how its file and the screen relate. */
export const useProject = create<ProjectStore>((set) => ({
    projects: [],
    current: null,
    rev: 0,
    dirty: false,
    conflict: null,
    error: null,
    setProjects(projects) {
        set({ projects });
    },
    setCurrent(current, rev) {
        set({ current, rev, dirty: false, conflict: null, error: null });
    },
    setRev(rev) {
        set({ rev });
    },
    setDirty(dirty) {
        set({ dirty });
    },
    setConflict(conflict) {
        set({ conflict });
    },
    setError(error) {
        set({ error });
    }
}));
