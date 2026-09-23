import type { LiveVoice, VoiceLanguage } from '@ruimte/contracts';

/* What the page sends with a live session; the shell turns it into the instruction and the voice. */
export interface OpenAiLivePreferences {
    language: VoiceLanguage;
    voice: LiveVoice;
    /* The action domains whose tools the session gets; absent from a page before this field, which gets them all. */
    domains?: string[];
}
