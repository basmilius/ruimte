export const VOICE_LANGUAGES = [
    { id: 'ar', label: 'العربية', instruction: 'Arabic' },
    { id: 'ca', label: 'Català', instruction: 'Catalan' },
    { id: 'zh', label: '中文', instruction: 'Chinese' },
    { id: 'cs', label: 'Čeština', instruction: 'Czech' },
    { id: 'da', label: 'Dansk', instruction: 'Danish' },
    { id: 'nl', label: 'Nederlands', instruction: 'Dutch' },
    { id: 'en', label: 'English', instruction: 'English' },
    { id: 'fi', label: 'Suomi', instruction: 'Finnish' },
    { id: 'fr', label: 'Français', instruction: 'French' },
    { id: 'de', label: 'Deutsch', instruction: 'German' },
    { id: 'el', label: 'Ελληνικά', instruction: 'Greek' },
    { id: 'he', label: 'עברית', instruction: 'Hebrew' },
    { id: 'hi', label: 'हिन्दी', instruction: 'Hindi' },
    { id: 'hu', label: 'Magyar', instruction: 'Hungarian' },
    { id: 'id', label: 'Bahasa Indonesia', instruction: 'Indonesian' },
    { id: 'it', label: 'Italiano', instruction: 'Italian' },
    { id: 'ja', label: '日本語', instruction: 'Japanese' },
    { id: 'ko', label: '한국어', instruction: 'Korean' },
    { id: 'no', label: 'Norsk', instruction: 'Norwegian' },
    { id: 'pl', label: 'Polski', instruction: 'Polish' },
    { id: 'pt', label: 'Português', instruction: 'Portuguese' },
    { id: 'ro', label: 'Română', instruction: 'Romanian' },
    { id: 'ru', label: 'Русский', instruction: 'Russian' },
    { id: 'es', label: 'Español', instruction: 'Spanish' },
    { id: 'sv', label: 'Svenska', instruction: 'Swedish' },
    { id: 'th', label: 'ไทย', instruction: 'Thai' },
    { id: 'tr', label: 'Türkçe', instruction: 'Turkish' },
    { id: 'uk', label: 'Українська', instruction: 'Ukrainian' },
    { id: 'vi', label: 'Tiếng Việt', instruction: 'Vietnamese' }
] as const;

export const LIVE_VOICES = ['marin', 'cedar'] as const;

export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]['id'];
export type LiveVoice = (typeof LIVE_VOICES)[number];

export const isVoiceLanguage = (value: unknown): value is VoiceLanguage => VOICE_LANGUAGES.some((language) => language.id === value);
export const isLiveVoice = (value: unknown): value is LiveVoice => LIVE_VOICES.some((voice) => voice === value);
