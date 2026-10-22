import { endpointIdIn, endpointIdOfMachine, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useOptionalConnection } from '@/transport/context';
import { windowWorkspace } from '@/state/window';

/*
 * A row in a store is about one daemon, and its key says which. Node ids are random, so this is not
 * about collisions: it is about ownership. A row that cannot name its machine sends a kill to the
 * wrong one and paints the status of a node that is not on this canvas.
 */
export function endpointKey(endpointId: string, id: string): string {
    return `${endpointId}:${id}`;
}

/* The first colon wins, since an endpoint id is base64url or the literal `local`, and neither carries one. */
export function splitKey(key: string): { endpointId: string; id: string } {
    const at = key.indexOf(':');
    if (at === -1) {
        return { endpointId: '', id: key };
    }
    return { endpointId: key.slice(0, at), id: key.slice(at + 1) };
}

export function isOfEndpoint(key: string, endpointId: string): boolean {
    return key.startsWith(`${endpointId}:`);
}

/* The machine a node runs on: the one it names, and the workspace's own when it names none. */
export function endpointOfNode(node: { machine?: string }, workspaceEndpointId: string): string {
    return node.machine === undefined ? workspaceEndpointId : endpointIdOfMachine(node.machine);
}

/* The same machine for a render, which follows a row that learns its daemon id. */
export function useEndpointOfNode(node: { machine?: string } | undefined, workspaceEndpointId: string): string {
    const machine = node?.machine;
    return useEndpoints((state) => (machine === undefined ? workspaceEndpointId : endpointIdIn(state.endpoints, machine)));
}

/* The same machine out of a list a render subscribed to, for a render that asks for many nodes. */
export function endpointOfNodeIn(endpoints: readonly Endpoint[], node: { machine?: string }, workspaceEndpointId: string): string {
    return node.machine === undefined ? workspaceEndpointId : endpointIdIn(endpoints, node.machine);
}

/*
 * One row patched in place, over the empty row for a key nothing was ever written to. A row arrives
 * a field at a time (it is loading, then it has content, then it is gone), and the empty row is what
 * says which fields the ones that have not arrived yet hold.
 */
export function patchIn<T extends object>(rows: Record<string, T>, key: string, empty: T, patch: Partial<T>): Record<string, T> {
    return {
        ...rows,
        [key]: { ...empty, ...rows[key], ...patch }
    };
}

/* Every row of one machine out of a store; what a forgotten machine and a project switch leave behind. */
export function dropEndpoint<T>(rows: Record<string, T>, endpointId: string): Record<string, T> {
    const next: Record<string, T> = {};
    for (const [key, value] of Object.entries(rows)) {
        if (!isOfEndpoint(key, endpointId)) {
            next[key] = value;
        }
    }
    return next;
}

/*
 * Which machine the code on screen is about: the daemon of the workspace it is rendered in, and the
 * active one for the shell around it (the palette, the settings, a toast), which is about the window rather than a project.
 */
export function useEndpointId(): string {
    const connection = useOptionalConnection();
    const activeId = useEndpoints((s) => s.activeId);
    return connection?.endpointId ?? activeId;
}

/*
 * The same answer outside a render, where there is no subtree to ask: the machine of the workspace on
 * screen, and the active one on the start screen.
 */
export function currentEndpointId(): string {
    return windowWorkspace()?.connection.endpointId ?? useEndpoints.getState().activeId;
}
