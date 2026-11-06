import { closedLidOffered, keepAwakeAvailable } from '@/controllers/keep-awake';
import { settingsRow as row, type SettingsSearchRow } from '@/registry/settings-sections';

export const AGENT_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    { id: 'agents.defaults.permissions', section: 'agents', label: 'settings:agents.defaults.permissions' },
    { id: 'agents.defaults.terminalMode', section: 'agents', label: 'settings:agents.defaults.terminalMode' },
    row('agents.resumeAtReset'),
    row('agents.deleteAnyView'),
    row('agents.reachOpenProjects'),
    row('agents.working.sound'),
    {
        id: 'agents.keepAwake.mode',
        section: 'agents',
        label: 'settings:agents.keepAwake.mode.label',
        description: 'settings:agents.keepAwake.mode.working.description',
        available: keepAwakeAvailable
    },
    {
        id: 'agents.keepAwake.lid',
        section: 'agents',
        label: 'settings:agents.keepAwake.lid.label',
        description: 'settings:agents.keepAwake.lid.search',
        available: closedLidOffered
    },
    { id: 'computer.enable', section: 'agents', label: 'settings:computer.allow', description: 'settings:computer.description' },
    {
        id: 'computer.grant.accessibility',
        section: 'agents',
        label: 'settings:computer.grant.accessibility.label',
        description: 'settings:computer.grant.accessibility.description'
    },
    {
        id: 'computer.grant.screenRecording',
        section: 'agents',
        label: 'settings:computer.grant.screenRecording.label',
        description: 'settings:computer.grant.screenRecording.description'
    }
];
