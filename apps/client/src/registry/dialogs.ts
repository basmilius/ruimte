import type { ComponentType } from 'react';
import { createRegistry } from './create-registry';

/*
 * A dialog of the window or of a workspace, mounted by the frame in the order it was registered. The
 * component opens itself from the state its feature owns, so the frame knows none of it.
 */
export interface DialogContribution {
    readonly id: string;
    /* The words of the failure a boundary around it says; null for a dialog that brings its own boundary. */
    readonly surface: string | null;
    readonly component: ComponentType;
}

/* Dialogs of the window: they open on the start screen too. */
export const windowDialogs = createRegistry<DialogContribution>('window dialog');

/* Dialogs about the project that is open. */
export const workspaceDialogs = createRegistry<DialogContribution>('workspace dialog');
