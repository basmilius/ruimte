import { resolveStoredPath } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useUnsaved } from '@/state/text-drafts';

/*
 * Whether the file a view or a node points at has unsaved changes on this client. The path is the
 * stored one, relative to the project folder; a row of another project names a file this window
 * does not edit, so it never has any.
 */
export const useUnsavedStoredPath = (stored: string | null, owner?: { endpointId: string; projectId: string }): boolean => {
    const endpointId = useEndpointId();
    const current = useProject((s) => s.current);
    const ours = owner === undefined || (owner.endpointId === endpointId && owner.projectId === current?.projectId);
    const path = ours && stored !== null ? resolveStoredPath(current?.folder ?? null, stored) : null;
    return useUnsaved(endpointId, path);
};
