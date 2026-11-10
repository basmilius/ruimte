import type { SettingsSearchRow } from '@/registry/settings-sections';
import { hasLocalMachine } from '@/state/local-machine';

export const TUNNEL_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    { id: 'tunnels.mcp', section: 'tunnels', label: 'settings:tunnels.clients.mcp', available: hasLocalMachine }
];
