import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { SlidersHorizontal, Users } from 'lucide-react';
import type { ProjectSettingsSectionDefinition } from '@/registry/project-settings-sections';

function words(key: string): () => string {
    return () => i18next.t(`shell:projectSettings.${key}`);
}

/* The sections of Project settings this folder brings, in the order of the navigation. */
export const PROJECT_SETTINGS_SECTIONS: readonly ProjectSettingsSectionDefinition[] = [
    {
        id: 'general',
        icon: SlidersHorizontal,
        label: words('sections.general.label'),
        description: words('sections.general.description'),
        pane: lazyNamed(() => import('@/project/ProjectGeneralPane'), 'ProjectGeneralPane'),
        rows: [
            { id: 'general.name', label: words('name') },
            { id: 'general.color', label: words('color') },
            { id: 'general.icon', label: () => i18next.t('common:icon.label') },
            { id: 'general.symbol', label: () => i18next.t('common:icon.symbol') }
        ]
    },
    {
        id: 'accounts',
        icon: Users,
        label: words('accounts'),
        description: words('accountsNote'),
        pane: lazyNamed(() => import('@/project/ProjectAccountsPane'), 'ProjectAccountsPane'),
        rows: [],
        // The accounts come with the project this window holds, and the Chats project follows the machine.
        available: ({ scratch, onScreen }) => !scratch && onScreen
    }
];
