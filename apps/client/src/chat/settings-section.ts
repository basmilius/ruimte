import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { MessagesSquare } from 'lucide-react';
import { CHAT_SETTINGS_ROWS } from '@/chat/settings-rows';
import type { SettingsSectionDefinition } from '@/registry/settings-sections';

export const CHAT_SETTINGS_SECTION: SettingsSectionDefinition = {
    id: 'chats',
    slot: 'ai',
    icon: MessagesSquare,
    label: () => i18next.t('settings:sections.chats.label'),
    description: () => i18next.t('settings:sections.chats.description'),
    pane: lazyNamed(() => import('@/chat/ChatsPane'), 'ChatsPane'),
    rows: CHAT_SETTINGS_ROWS
};
