import { join } from 'node:path';
import { VoicePreferencesSchema, type LiveVoice, type VoiceLanguage, type VoicePreferences } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { JsonFileStore } from '../json-file-store.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { VOICE_DIR } from './key-store.ts';

const PREFERENCES_FILE = 'preferences.json';

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = { language: 'en', voice: 'marin' };

/*
 * How Voice on this machine talks, in `$RUIMTE_HOME/voice/preferences.json` beside the key. No secret: any
 * client that may use Voice reads and sets it, and every client hears a change, so the desktop and the phone
 * show the same choice. Without a home it keeps nothing, which is how a test runs it in memory.
 */
export class VoicePreferencesStore {
    private readonly sinks = new ClientSinks();
    private readonly file: JsonFileStore<VoicePreferences>;
    private current: VoicePreferences | null;

    constructor(home?: string) {
        this.file = new JsonFileStore(
            home === undefined ? undefined : join(home, VOICE_DIR, PREFERENCES_FILE),
            VoicePreferencesSchema,
            'Voice follows its start'
        );
        this.current = this.file.read();
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Null while no client set any. */
    get(): VoicePreferences | null {
        return this.current;
    }

    set(preferences: VoicePreferences): VoicePreferences {
        const next = { language: preferences.language, voice: preferences.voice };
        this.file.write(next);
        this.current = next;
        this.sinks.emit({ event: 'voice.preferences', payload: { preferences: next } });
        return next;
    }
}

/* What a session speaks: the machine's preferences first, then what the start carries, then English and marin. */
export function voicePreferencesFor(stored: VoicePreferences | null, start: { language?: VoiceLanguage; voice?: LiveVoice }): VoicePreferences {
    return {
        language: stored?.language ?? start.language ?? DEFAULT_VOICE_PREFERENCES.language,
        voice: stored?.voice ?? start.voice ?? DEFAULT_VOICE_PREFERENCES.voice
    };
}
