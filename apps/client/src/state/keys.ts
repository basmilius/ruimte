import { useEndpoints } from '@/state/endpoints';
import { useOptionalConnection } from '@/transport/context';
import { windowWorkspace } from '@/state/window';

/*
 * A row in a store is about one daemon, and its key says which. Node ids are random, so this is not
 * about collisions: it is about ownership. A row that cannot name its machine sends a kill to the
 * wrong one and paints the status of a node that is not on this canvas.
 */
export const endpointKey = (endpointId: string, id: string): string => `${endpointId}:${id}`;

/* The first colon wins, since an endpoint id is base64url or the literal `local`, and neither carries one. */
export const splitKey = (key: string): { endpointId: string; id: string } => {
    const at = key.indexOf(':');
    if (at === -1) {
        return { endpointId: '', id: key };
    }
    return { endpointId: key.slice(0, at), id: key.slice(at + 1) };
};

export const isOfEndpoint = (key: string, endpointId: string): boolean => key.startsWith(`${endpointId}:`);

/*
 * One row patched in place, over the empty row for a key nothing was ever written to. A row arrives
 * a field at a time (it is loading, then it has content, then it is gone), and the empty row is what
 * says which fields the ones that have not arrived yet hold.
 */
export const patchIn = <T extends object>(rows: Record<string, T>, key: string, empty: T, patch: Partial<T>): Record<string, T> => ({
    ...rows,
    [key]: { ...empty, ...rows[key], ...patch }
});

/* Every row of one machine out of a store; what a forgotten machine and a project switch leave behind. */
export const dropEndpoint = <T>(rows: Record<string, T>, endpointId: string): Record<string, T> => {
    const next: Record<string, T> = {};
    for (const [key, value] of Object.entries(rows)) {
        if (!isOfEndpoint(key, endpointId)) {
            next[key] = value;
        }
    }
    return next;
};

/*
 * Which machine the code on screen is about: the daemon of the workspace it is rendered in, and the
 * active one for the shell around it (the palette, the settings, a toast), which is about the window rather than a project.
 */
export const useEndpointId = (): string => {
    const connection = useOptionalConnection();
    const activeId = useEndpoints((s) => s.activeId);
    return connection?.endpointId ?? activeId;
};

/*
 * The same answer outside a render, where there is no subtree to ask: the machine of the workspace on
 * screen, and the active one on the start screen.
 */
export const currentEndpointId = (): string => windowWorkspace()?.connection.endpointId ?? useEndpoints.getState().activeId;
