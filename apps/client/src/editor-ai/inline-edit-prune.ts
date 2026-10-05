import { isConnectionError } from '@/transport/transport';
import { expiredInlineEdits, forgetInlineEdit } from './inline-edit-record';
import type { LastProjectStorage } from '@/project/last-project';

export interface PruneDeps {
    now(): number;
    /* Takes the hidden chat view away on the machine, ending its chat. */
    remove(projectId: string, viewId: string): Promise<void>;
    storage?: LastProjectStorage | null;
}

/*
 * Takes away the inline edits nobody came back to for a week, each hidden chat with its record. A
 * machine that cannot be reached leaves the rest for the next try, and a chat the machine no longer
 * knows is as good as removed. False when it stopped early because the machine was out of reach.
 */
export async function pruneInlineEdits(endpointId: string, deps: PruneDeps): Promise<boolean> {
    for (const record of expiredInlineEdits(endpointId, deps.now(), deps.storage)) {
        try {
            await deps.remove(record.projectId, record.viewId);
        } catch (e) {
            if (isConnectionError(e)) {
                return false;
            }
        }
        forgetInlineEdit(endpointId, record.path, record.chatId, deps.storage);
    }
    return true;
}

const swept = new Set<string>();

/* The first editor of a machine in this window sweeps it; one that found the machine away asks again with the next editor. */
export function sweepInlineEdits(endpointId: string, deps: PruneDeps): void {
    if (swept.has(endpointId)) {
        return;
    }
    swept.add(endpointId);
    void pruneInlineEdits(endpointId, deps).then((complete) => {
        if (!complete) {
            swept.delete(endpointId);
        }
    });
}
