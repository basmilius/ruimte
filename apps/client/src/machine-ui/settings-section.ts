import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { Server } from 'lucide-react';
import { MACHINE_SETTINGS_ROWS } from '@/machine-ui/settings-rows';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';

export const MACHINE_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'machines',
    slot: 'account',
    icon: Server,
    split: true,
    label: () => i18next.t('settings:sections.machines.label'),
    description: () => i18next.t('settings:sections.machines.description'),
    pane: lazyNamed(() => import('@/machine-ui/MachinesPane'), 'MachinesPane'),
    rows: MACHINE_SETTINGS_ROWS
};
