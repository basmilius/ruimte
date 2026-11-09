import { LayoutDialog } from '@/canvas/LayoutDialog';
import { createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

export const layoutDialog = createFlagState();

export const CANVAS_DIALOGS: readonly DialogContribution[] = [{ id: 'canvas-layout', surface: 'dialog', component: LayoutDialog }];
