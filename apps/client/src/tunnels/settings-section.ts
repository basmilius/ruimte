import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { Cable } from 'lucide-react';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';
import { TUNNEL_SETTINGS_ROWS } from '@/tunnels/settings-rows';

export const TUNNEL_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'tunnels',
    slot: 'ai',
    icon: Cable,
    label: () => i18next.t('settings:sections.tunnels.label'),
    description: () => i18next.t('settings:sections.tunnels.description'),
    pane: lazyNamed(() => import('@/tunnels/TunnelsPane'), 'TunnelsPane'),
    rows: TUNNEL_SETTINGS_ROWS
};
