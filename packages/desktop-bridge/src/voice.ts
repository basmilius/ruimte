import type { LiveVoice, VoiceLanguage } from '@ruimte/contracts';

/* What the page sends with a live session; the shell turns it into the instruction and the voice. */
export interface OpenAiLivePreferences {
    language: VoiceLanguage;
    voice: LiveVoice;
}
