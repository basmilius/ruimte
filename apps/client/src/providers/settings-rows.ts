import { type SettingsSearchRow } from '@/registry/settings-sections';

export const PROVIDER_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    // On the detail of the CLI the pane opens on.
    {
        id: 'providers.defaults.model',
        section: 'providers',
        label: 'agent-providers:cli.defaults.model',
        description: 'agent-providers:cli.defaults.usesCliDefault'
    },
    {
        id: 'providers.acpServer',
        section: 'providers',
        label: 'settings:providers.acpServer.searchLabel',
        description: 'settings:providers.acpServer.description'
    }
];
