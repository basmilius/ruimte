import { create } from 'zustand';
import type { ProjectDocument, ProjectIconChoice, ProjectSummary } from '@ruimte/contracts';

interface ProjectStore {
    projects: ProjectSummary[];
    current: ProjectSummary | null;
    /* The rev the canvas on screen came from; every save names it. */
    rev: number;
    /* The icon the file names, kept apart from the summary's so a save cannot drop it. */
    chosenIcon: ProjectIconChoice | null;
    /* Edits since the last save reached the daemon. */
    dirty: boolean;
    /* What the file holds now, when it changed on disk while there were unsaved edits. */
    conflict: ProjectDocument | null;
    /* Why the last save or open failed, for the banner. */
    error: string | null;
    /* A project is being opened; the canvas under it is the old one until the document arrives. */
    switching: boolean;
    setProjects(projects: ProjectSummary[]): void;
    setCurrent(current: ProjectSummary | null, rev: number): void;
    setRev(rev: number): void;
    setChosenIcon(chosenIcon: ProjectIconChoice | null): void;
    /* What the daemon says the current project looks like now, without touching the save state. */
    setSummary(summary: ProjectSummary): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: ProjectDocument | null): void;
    setError(error: string | null): void;
    setSwitching(switching: boolean): void;
}

/* Which project is on the canvas and how its file and the screen relate. */
export const useProject = create<ProjectStore>((set) => ({
    projects: [],
    current: null,
    rev: 0,
    chosenIcon: null,
    dirty: false,
    conflict: null,
    error: null,
    switching: false,
    setProjects(projects) {
        set({ projects });
    },
    setCurrent(current, rev) {
        set({ current, rev, dirty: false, conflict: null, error: null });
    },
    setRev(rev) {
        set({ rev });
    },
    setChosenIcon(chosenIcon) {
        set({ chosenIcon });
    },
    setSummary(summary) {
        set({ current: summary });
    },
    setDirty(dirty) {
        set({ dirty });
    },
    setConflict(conflict) {
        set({ conflict });
    },
    setError(error) {
        set({ error });
    },
    setSwitching(switching) {
        set({ switching });
    }
}));
