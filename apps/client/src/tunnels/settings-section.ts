import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { Cable, Plug } from 'lucide-react';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';
import { MCP_SETTINGS_ROWS } from '@/tunnels/settings-rows';

export const TUNNEL_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'tunnels',
    slot: 'workspace',
    icon: Cable,
    label: () => i18next.t('settings:sections.tunnels.label'),
    description: () => i18next.t('settings:sections.tunnels.description'),
    pane: lazyNamed(() => import('@/tunnels/TunnelsPane'), 'TunnelsPane'),
    rows: []
};

export const MCP_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'mcp',
    slot: 'ai',
    tabOf: 'agents',
    icon: Plug,
    label: () => i18next.t('settings:sections.mcp.label'),
    description: () => i18next.t('settings:sections.mcp.description'),
    pane: lazyNamed(() => import('@/tunnels/McpPane'), 'McpPane'),
    rows: MCP_SETTINGS_ROWS
};
