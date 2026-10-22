import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '../sessions/manager.ts';
import { VoicePreferencesStore, voicePreferencesFor } from './preferences-store.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-voice-preferences-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('the preferences of Voice on the machine', () => {
    test('start empty, and a set is written whole beside the key and read again by the next daemon', async () => {
        const store = new VoicePreferencesStore(home);
        expect(store.get()).toBeNull();
        expect(store.set({ language: 'nl', voice: 'cedar' })).toEqual({ language: 'nl', voice: 'cedar' });
        expect(JSON.parse(await readFile(join(home, 'voice', 'preferences.json'), 'utf8'))).toEqual({ language: 'nl', voice: 'cedar' });
        expect((await stat(join(home, 'voice'))).mode & 0o777).toBe(0o700);
        expect(new VoicePreferencesStore(home).get()).toEqual({ language: 'nl', voice: 'cedar' });
    });

    test('a file that will not read counts as none', async () => {
        await mkdir(join(home, 'voice'), { recursive: true });
        await writeFile(join(home, 'voice', 'preferences.json'), JSON.stringify({ language: 'klingon', voice: 'marin' }));
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            expect(new VoicePreferencesStore(home).get()).toBeNull();
        } finally {
            warn.mockRestore();
        }
    });

    test('every subscribed client hears a change, and one that left hears nothing', () => {
        const store = new VoicePreferencesStore();
        const phone: SessionEvent[] = [];
        const desktop: SessionEvent[] = [];
        store.subscribe('phone', (event) => phone.push(event));
        const leave = store.subscribe('desktop', (event) => desktop.push(event));
        store.set({ language: 'de', voice: 'marin' });
        leave();
        store.set({ language: 'en', voice: 'cedar' });
        expect(phone).toEqual([
            { event: 'voice.preferences', payload: { preferences: { language: 'de', voice: 'marin' } } },
            { event: 'voice.preferences', payload: { preferences: { language: 'en', voice: 'cedar' } } }
        ]);
        expect(desktop).toEqual([{ event: 'voice.preferences', payload: { preferences: { language: 'de', voice: 'marin' } } }]);
    });

    test('a session speaks as the machine stores first, then as its start says, then English with marin', () => {
        expect(voicePreferencesFor(null, {})).toEqual({ language: 'en', voice: 'marin' });
        expect(voicePreferencesFor(null, { language: 'nl', voice: 'cedar' })).toEqual({ language: 'nl', voice: 'cedar' });
        expect(voicePreferencesFor({ language: 'ja', voice: 'marin' }, { language: 'nl', voice: 'cedar' })).toEqual({ language: 'ja', voice: 'marin' });
    });
});
