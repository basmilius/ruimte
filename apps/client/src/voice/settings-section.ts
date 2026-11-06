import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { Mic } from 'lucide-react';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';
import { VOICE_SETTINGS_ROWS } from '@/voice/settings-rows';

export const VOICE_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'voice',
    slot: 'ai',
    icon: Mic,
    label: () => i18next.t('settings:sections.voice.label'),
    description: () => i18next.t('settings:sections.voice.description'),
    pane: lazyNamed(() => import('@/voice/VoicePane'), 'VoicePane'),
    rows: VOICE_SETTINGS_ROWS
};
