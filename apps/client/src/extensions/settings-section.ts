import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { Puzzle } from 'lucide-react';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';

export const EXTENSION_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'extensions',
    slot: 'workspace',
    icon: Puzzle,
    split: true,
    label: () => i18next.t('settings:sections.extensions.label'),
    description: () => i18next.t('settings:sections.extensions.description'),
    pane: lazyNamed(() => import('@/extensions/ExtensionsPane'), 'ExtensionsPane'),
    rows: []
};
