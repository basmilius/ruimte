import { USAGE_SECTION } from '@adecore/agents-react';
import { lazyNamed } from '@adecore/ui';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';
import { USAGE_SETTINGS_ROWS } from '@/usage/settings-rows';

export const USAGE_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'usage',
    slot: 'ai',
    icon: USAGE_SECTION.icon,
    label: USAGE_SECTION.label,
    description: USAGE_SECTION.description,
    pane: lazyNamed(() => import('@/usage/UsagePane'), 'UsagePane'),
    rows: USAGE_SETTINGS_ROWS
};
