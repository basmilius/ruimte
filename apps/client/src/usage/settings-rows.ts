import { type SettingsSearchRow } from '@/registry/settings-sections';

export const USAGE_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    { id: 'usage.currency', section: 'usage', label: 'agent-usage:settings.currency.label', description: 'agent-usage:settings.currency.dollars' },
    { id: 'usage.page', section: 'usage', label: 'agent-usage:settings.page.label', description: 'agent-usage:settings.page.description' }
];
