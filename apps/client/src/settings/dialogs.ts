import { lazyDialog } from '@adecore/ui';
import type { DialogContribution } from '@/registry/dialogs';
import { useUi } from '@/state/ui';

const SettingsDialog = lazyDialog(
    () => import('@/settings/SettingsDialog'),
    'SettingsDialog',
    useUi,
    (s) => s.settings.open
);

export const SETTINGS_DIALOGS: readonly DialogContribution[] = [{ id: 'settings', surface: 'settings', component: SettingsDialog }];
