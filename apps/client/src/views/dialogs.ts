import type { DialogContribution } from '@/registry/dialogs';
import { ViewDialogs } from '@/views/ViewDialogs';

export const VIEW_DIALOGS: readonly DialogContribution[] = [{ id: 'view', surface: 'dialog', component: ViewDialogs }];
