import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { Bot, MousePointer2, SquareTerminal } from 'lucide-react';
import { AGENT_SETTINGS_ROWS, COMPUTER_SETTINGS_ROWS, TERMINAL_AGENT_SETTINGS_ROWS } from '@/agents/settings-rows';
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

/* Its id is not `terminal`, which is the section of the terminal itself under Workspace. */
export const TERMINAL_AGENT_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'terminalAgents',
    slot: 'ai',
    tabOf: 'agents',
    icon: SquareTerminal,
    label: () => i18next.t('settings:sections.terminalAgents.label'),
    description: () => i18next.t('settings:sections.terminalAgents.description'),
    pane: lazyNamed(() => import('@/agents/IntegrationsSection'), 'IntegrationsSection'),
    rows: TERMINAL_AGENT_SETTINGS_ROWS
};

export const COMPUTER_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'computer',
    slot: 'ai',
    tabOf: 'agents',
    icon: MousePointer2,
    label: () => i18next.t('settings:sections.computer.label'),
    description: () => i18next.t('settings:sections.computer.description'),
    pane: lazyNamed(() => import('@/computer/ComputerSections'), 'ComputerSections'),
    rows: COMPUTER_SETTINGS_ROWS
};
