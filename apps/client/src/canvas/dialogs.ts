import { LayoutDialog } from '@/canvas/LayoutDialog';
import { createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

/* The dialog that names the layout of the canvas in front. */
export const layoutDialog = createFlagState();

export const CANVAS_DIALOGS: readonly DialogContribution[] = [{ id: 'canvas-layout', surface: 'dialog', component: LayoutDialog }];
