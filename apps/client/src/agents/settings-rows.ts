import { closedLidOffered, keepAwakeAvailable } from '@/controllers/keep-awake';
import { canTellIdle } from '@/desktop/bridge';
import { settingsRow as row, type SettingsSearchRow } from '@/registry/settings-sections';
import { hasOpenedMachine } from '@/state/local-machine';

/* Drawn under General, Notifications; their words stay where they were. */
export const NOTIFICATION_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    row('agents.sounds.pack'),
    row('agents.quietHours'),
    row('agents.breakReminder', canTellIdle)
];

export const AGENT_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    { id: 'agents.defaults.permissions', section: 'agents', label: 'settings:agents.defaults.permissions' },
    row('agents.textModel', hasOpenedMachine),
    { id: 'agents.defaults.terminalMode', section: 'agents', label: 'settings:agents.defaults.terminalMode' },
    row('agents.resumeAtReset'),
    row('agents.deleteAnyView'),
    row('agents.reachOpenProjects'),
    row('agents.showViews'),
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
    }
];

export const COMPUTER_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    { id: 'computer.enable', section: 'computer', label: 'settings:computer.allow', description: 'settings:computer.description' },
    {
        id: 'computer.grant.accessibility',
        section: 'computer',
        label: 'settings:computer.grant.accessibility.label',
        description: 'settings:computer.grant.accessibility.description'
    },
    {
        id: 'computer.grant.screenRecording',
        section: 'computer',
        label: 'settings:computer.grant.screenRecording.label',
        description: 'settings:computer.grant.screenRecording.description'
    }
];
