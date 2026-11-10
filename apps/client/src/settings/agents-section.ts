import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { Bot } from 'lucide-react';
import { AGENT_SETTINGS_ROWS } from '@/agents/settings-rows';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';

/* Its pane draws the sections of the computer and the machines too, so the section sits with the settings, not in a feature. */
export const AGENT_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'agents',
    slot: 'ai',
    icon: Bot,
    label: () => i18next.t('settings:sections.agents.label'),
    description: () => i18next.t('settings:sections.agents.description'),
    pane: lazyNamed(() => import('@/settings/panes/AgentsPane'), 'AgentsPane'),
    rows: AGENT_SETTINGS_ROWS
};
