import { createDialogState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';
import { ViewDialogs } from '@/views/ViewDialogs';

/* What a view is being asked about, from the sidebar, the breadcrumb or the palette alike. */
export type ViewDialog =
    | { kind: 'settings'; viewId: string }
    /* Promoting a node that has lines drawn into it. Those lines do not survive the move. */
    | { kind: 'promote'; nodeId: string }
    | { kind: 'new-browser' };

export const viewDialog = createDialogState<ViewDialog>();

export const VIEW_DIALOGS: readonly DialogContribution[] = [{ id: 'view', surface: 'dialog', component: ViewDialogs }];
