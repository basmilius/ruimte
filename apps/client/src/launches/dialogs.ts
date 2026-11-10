import { lazyDialog } from '@adecore/ui';
import { useLaunches } from '@/launches/state';
import type { DialogContribution } from '@/registry/dialogs';

const LaunchDialogs = lazyDialog(
    () => import('@/launches/LaunchDialogs'),
    'LaunchDialogs',
    useLaunches,
    (s) => s.dialog !== null
);

export const LAUNCH_DIALOGS: readonly DialogContribution[] = [{ id: 'launches', surface: 'dialog', component: LaunchDialogs }];
