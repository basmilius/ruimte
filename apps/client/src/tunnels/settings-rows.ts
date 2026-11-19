import type { SettingsSearchRow } from '@/registry/settings-sections';
import { hasLocalMachine } from '@/state/local-machine';

export const MCP_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    { id: 'tunnels.mcp', section: 'mcp', label: 'settings:tunnels.clients.mcp', available: hasLocalMachine }
];
