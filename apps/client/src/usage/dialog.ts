import { lazyDialog } from '@adecore/ui';
import { createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

export const usageDialog = createFlagState();

const UsageDialog = lazyDialog(
    () => import('@/usage/UsageDialog'),
    'UsageDialog',
    usageDialog.store,
    (state) => state.open
);

export const USAGE_DIALOGS: readonly DialogContribution[] = [{ id: 'usage', surface: null, component: UsageDialog }];
