import { createContext, useContext } from 'react';

export interface FileToolbarSlot {
    /* Where a file's controls go instead of into a bar of their own; null means it draws its own. */
    host: HTMLElement | null;
    /* How the surface hands its element over, as a ref callback. Null where the host is fixed. */
    mount: ((element: HTMLElement | null) => void) | null;
}

const EMPTY: FileToolbarSlot = { host: null, mount: null };

/*
 * Where the controls of the file on screen belong. A view and a node already carry a bar above the body
 * (the window's toolbar, the node's header), so the renderer portals its controls up into that one
 * rather than drawing a second row; the state stays in the renderer.
 */
const FileToolbarSlotContext = createContext<FileToolbarSlot>(EMPTY);

export const FileToolbarSlotProvider = FileToolbarSlotContext.Provider;

export function useFileToolbarSlot(): FileToolbarSlot {
    return useContext(FileToolbarSlotContext);
}

/* A node hosts its own controls in its header, so nothing inside it may reach for the window's. */
export function fixedSlot(host: HTMLElement | null): FileToolbarSlot {
    return { host, mount: null };
}
