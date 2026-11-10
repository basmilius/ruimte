import { lazyDialog } from '@adecore/ui';
import { createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

export const modelsDialog = createFlagState();

const ModelsDialog = lazyDialog(
    () => import('@/models/ModelsDialog'),
    'ModelsDialog',
    modelsDialog.store,
    (state) => state.open
);

export const MODELS_DIALOGS: readonly DialogContribution[] = [{ id: 'models', surface: null, component: ModelsDialog }];
