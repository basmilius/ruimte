import { createContext, useContext } from 'react';

export interface FileToolbarSlot {
    /* Where a file's controls go instead of into a bar of their own; null means it draws its own. */
    host: HTMLElement | null;
    /* How the surface hands its element over, as a ref callback. Null where the host is fixed. */
    mount: ((element: HTMLElement | null) => void) | null;
}

const EMPTY: FileToolbarSlot = { host: null, mount: null };

/*
 * Where the controls of the file on screen belong. A renderer draws its own bar inside the preview
 * panel, where the file is one tab among several; a view of its own and a node already carry a bar
 * above the body (the window's toolbar, the node's header), and a second one under it would be two
 * rows saying the same thing. The state lives in the renderer either way, so the markup is portaled
 * up rather than the state pushed down.
 */
const FileToolbarSlotContext = createContext<FileToolbarSlot>(EMPTY);

export const FileToolbarSlotProvider = FileToolbarSlotContext.Provider;

export const useFileToolbarSlot = (): FileToolbarSlot => useContext(FileToolbarSlotContext);

/* A node hosts its own controls in its header, so nothing inside it may reach for the window's. */
export const fixedSlot = (host: HTMLElement | null): FileToolbarSlot => ({ host, mount: null });
