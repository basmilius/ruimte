import { settingsRow as row, type SettingsSearchRow } from '@/registry/settings-sections';

export const CHAT_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    {
        id: 'chats.streaming',
        section: 'chats',
        label: 'settings:chats.streaming.label',
        description: 'settings:chats.streaming.words.description'
    },
    row('chats.readingWidth'),
    row('chats.showToolCalls'),
    row('chats.sendKey'),
    row('chats.steerByDefault'),
    row('chats.showViews'),
    row('chats.mapTiles'),
    { id: 'agents.visualReplies', section: 'chats', label: 'settings:agents.visualReplies.label', description: 'settings:agents.visualReplies.description' }
];
