/*
 * The languages the live voice speaks, as the picker offers them and as the shell names them in the
 * instruction it sends with a session. One list: a language in only one of the two would be offered
 * by the picker and then quietly refused when the shell read the preference back. A label is how a
 * language writes its own name, the same in a Dutch interface and an English one; `english` is the
 * name the instruction to the model is built with.
 */
export const VOICE_LANGUAGES = [
    { id: 'ar', label: 'العربية', english: 'Arabic' },
    { id: 'ca', label: 'Català', english: 'Catalan' },
    { id: 'zh', label: '中文', english: 'Chinese' },
    { id: 'cs', label: 'Čeština', english: 'Czech' },
    { id: 'da', label: 'Dansk', english: 'Danish' },
    { id: 'nl', label: 'Nederlands', english: 'Dutch' },
    { id: 'en', label: 'English', english: 'English' },
    { id: 'fi', label: 'Suomi', english: 'Finnish' },
    { id: 'fr', label: 'Français', english: 'French' },
    { id: 'de', label: 'Deutsch', english: 'German' },
    { id: 'el', label: 'Ελληνικά', english: 'Greek' },
    { id: 'he', label: 'עברית', english: 'Hebrew' },
    { id: 'hi', label: 'हिन्दी', english: 'Hindi' },
    { id: 'hu', label: 'Magyar', english: 'Hungarian' },
    { id: 'id', label: 'Bahasa Indonesia', english: 'Indonesian' },
    { id: 'it', label: 'Italiano', english: 'Italian' },
    { id: 'ja', label: '日本語', english: 'Japanese' },
    { id: 'ko', label: '한국어', english: 'Korean' },
    { id: 'no', label: 'Norsk', english: 'Norwegian' },
    { id: 'pl', label: 'Polski', english: 'Polish' },
    { id: 'pt', label: 'Português', english: 'Portuguese' },
    { id: 'ro', label: 'Română', english: 'Romanian' },
    { id: 'ru', label: 'Русский', english: 'Russian' },
    { id: 'es', label: 'Español', english: 'Spanish' },
    { id: 'sv', label: 'Svenska', english: 'Swedish' },
    { id: 'th', label: 'ไทย', english: 'Thai' },
    { id: 'tr', label: 'Türkçe', english: 'Turkish' },
    { id: 'uk', label: 'Українська', english: 'Ukrainian' },
    { id: 'vi', label: 'Tiếng Việt', english: 'Vietnamese' }
] as const;

export const LIVE_VOICES = ['marin', 'cedar'] as const;

export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]['id'];
export type LiveVoice = (typeof LIVE_VOICES)[number];

export const isVoiceLanguage = (value: unknown): value is VoiceLanguage => VOICE_LANGUAGES.some((language) => language.id === value);
export const isLiveVoice = (value: unknown): value is LiveVoice => LIVE_VOICES.some((voice) => voice === value);
