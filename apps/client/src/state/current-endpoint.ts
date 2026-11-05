import { createContext, useContext } from 'react';
import { useEndpoints } from '@/state/endpoints';

/* The daemon of the workspace the code on screen is rendered in, provided by `transport/ConnectionProvider`. */
export const WorkspaceEndpointContext = createContext<string | null>(null);

let workspaceEndpointId: string | null = null;

/* Kept by `transport/window.ts` for as long as the window shows a workspace. */
export function setWorkspaceEndpointId(endpointId: string | null): void {
    workspaceEndpointId = endpointId;
}

/*
 * Which machine the code on screen is about: the daemon of the workspace it is rendered in, and the
 * active one for the shell around it (the palette, the settings, a toast), which is about the window rather than a project.
 */
export function useEndpointId(): string {
    const scoped = useContext(WorkspaceEndpointContext);
    const activeId = useEndpoints((s) => s.activeId);
    return scoped ?? activeId;
}

/*
 * The same answer outside a render, where there is no subtree to ask: the machine of the workspace on
 * screen, and the active one on the start screen.
 */
export function currentEndpointId(): string {
    return workspaceEndpointId ?? useEndpoints.getState().activeId;
}
