import { createStore, type StoreApi } from 'zustand';
import type { ProjectDocument, ProjectIconChoice, ProjectSummary } from '@ruimte/contracts';
import { storeHook } from '@/state/workspace-stores';

export type { ProjectRow } from '@/state/project-list';

export interface ProjectState {
    /* Null only while the window shows the start screen. The store outlives every workspace, so the watchers holding it never have to be told about a new one. */
    current: ProjectSummary | null;
    /* Which daemon the open project came from; during an open it is not yet the active one. */
    currentEndpointId: string | null;
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
    setCurrent(current: ProjectSummary | null, rev: number, endpointId: string | null): void;
    setRev(rev: number): void;
    setChosenIcon(chosenIcon: ProjectIconChoice | null): void;
    /* What the daemon says the current project looks like now, without touching the save state. */
    setSummary(summary: ProjectSummary): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: ProjectDocument | null): void;
    setError(error: string | null): void;
    setSwitching(switching: boolean): void;
}

/*
 * Which project the window has on the canvas and how its file and the screen relate. The app makes
 * one; a test makes its own, since two project clients sharing a store would answer for each other's saves.
 */
export const createProjectStore = (): StoreApi<ProjectState> =>
    createStore<ProjectState>((set) => ({
        current: null,
        currentEndpointId: null,
        rev: 0,
        chosenIcon: null,
        dirty: false,
        conflict: null,
        error: null,
        switching: false,
        setCurrent(current, rev, endpointId) {
            set({ current, currentEndpointId: current ? endpointId : null, rev, dirty: false, conflict: null, error: null });
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

export const defaultProjectStore = createProjectStore();

export const useProject = storeHook(defaultProjectStore);
