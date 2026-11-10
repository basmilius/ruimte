import { type SettingsSearchRow } from '@/registry/settings-sections';

export const VOICE_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    {
        id: 'voice.microphone',
        section: 'voice',
        label: 'settings:voice.conversation.microphone.label',
        description: 'settings:voice.conversation.microphone.description'
    },
    {
        id: 'voice.language',
        section: 'voice',
        label: 'settings:voice.conversation.language.label',
        description: 'settings:voice.conversation.language.description'
    },
    { id: 'voice.dictation', section: 'voice', label: 'voice:dictation.enable', description: 'voice:dictation.description' },
    { id: 'voice.key', section: 'voice', label: 'settings:voice.key.label', description: 'settings:voice.key.sectionDescription' },
    {
        id: 'voice.conversationLanguage',
        section: 'voice',
        label: 'settings:voice.conversation.machineLanguage.label',
        description: 'settings:voice.conversation.machineLanguage.description'
    },
    { id: 'voice.voice', section: 'voice', label: 'settings:voice.conversation.voice.label', description: 'settings:voice.conversation.voice.description' },
    {
        id: 'voice.confirm',
        section: 'voice',
        label: 'settings:voice.conversation.confirm.label',
        description: 'settings:voice.conversation.confirm.description'
    }
];
