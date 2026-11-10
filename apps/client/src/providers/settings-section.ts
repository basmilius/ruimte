import { PROVIDERS_SECTION } from '@adecore/agents-react';
import { lazyNamed } from '@adecore/ui';
import { PROVIDER_SETTINGS_ROWS } from '@/providers/settings-rows';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';

export const PROVIDER_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'providers',
    slot: 'ai',
    icon: PROVIDERS_SECTION.icon,
    split: PROVIDERS_SECTION.split,
    label: PROVIDERS_SECTION.label,
    description: PROVIDERS_SECTION.description,
    pane: lazyNamed(() => import('@/providers/ProvidersPane'), 'ProvidersPane'),
    rows: PROVIDER_SETTINGS_ROWS
};
