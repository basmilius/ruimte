import { create } from 'zustand';
import type { ProjectSummary } from '@ruimte/contracts';

/*
 * One project of one daemon. A project id is minted by the daemon that owns it, so the same id on
 * two machines would be two projects; the endpoint is what tells them apart, and it is the client's
 * knowledge rather than anything the daemon says.
 */
export interface ProjectRow {
    endpointId: string;
    summary: ProjectSummary;
}

interface ProjectListStore {
    /* Every machine's projects at once, in the order each machine's last list answered. */
    projects: ProjectRow[];
    /* One machine's answer, replacing whatever that machine had listed before. */
    setProjects(endpointId: string, summaries: ProjectSummary[]): void;
    /* One row of one machine, for a rename or an icon that changed under the list. */
    patchProject(endpointId: string, summary: ProjectSummary): void;
    /* Every row of a machine this client no longer knows. */
    forgetProjects(endpointId: string): void;
}

/*
 * What every machine has to offer, in one list. This is the client's knowledge and not a workspace's:
 * the start screen and the switcher read the same union, whichever project is open or none.
 */
export const useProjectList = create<ProjectListStore>((set, get) => ({
    projects: [],
    setProjects(endpointId, summaries) {
        const others = get().projects.filter((row) => row.endpointId !== endpointId);
        set({ projects: [...others, ...summaries.map((summary) => ({ endpointId, summary }))] });
    },
    patchProject(endpointId, summary) {
        set({
            projects: get().projects.map((row) => (row.endpointId === endpointId && row.summary.projectId === summary.projectId ? { ...row, summary } : row))
        });
    },
    forgetProjects(endpointId) {
        set({ projects: get().projects.filter((row) => row.endpointId !== endpointId) });
    }
}));
