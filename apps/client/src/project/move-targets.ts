import type { ProjectSummary } from '@ruimte/contracts';
import { openableRows, recentProjects } from '@/clients/project/list';
import type { Endpoint } from '@/state/endpoints';
import type { ProjectRow } from '@/state/project-list';

/* How many projects the menu names before "Other project…". */
const MOVE_TARGET_LIMIT = 5;

/*
 * The projects of one machine a chat in Chats can move to without a dialog first: the ones touched
 * last that can still be opened. The machine's Chats project is never one of them, and a chat only
 * moves within its own machine.
 */
export function moveTargetsOf(rows: ProjectRow[], endpoints: Endpoint[], endpointId: string): ProjectSummary[] {
    return moveCandidatesOf(rows, endpoints, endpointId).slice(0, MOVE_TARGET_LIMIT);
}

/* Every project of the machine a chat can move to, the ones touched last first. */
export function moveCandidatesOf(rows: ProjectRow[], endpoints: Endpoint[], endpointId: string): ProjectSummary[] {
    const here = rows.filter((row) => row.endpointId === endpointId);
    return openableRows(recentProjects(here, endpoints, [endpointId])).map((row) => row.summary);
}
