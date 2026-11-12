import { afterEach, beforeEach, expect, test } from 'bun:test';
import { useSettings } from '@/state/settings';
import type { SoundEvent } from '@/state/sounds';
import {
    addCustomSoundPack,
    removeCustomSoundPack,
    renameCustomSoundPack,
    setCustomSound,
    setCustomSoundFiles,
    setSoundFileSeconds,
    SOUND_FILE_MAX_BYTES,
    soundFileRefusal,
    type CustomSoundFiles
} from './custom-sounds';

let kept: Map<string, Blob>;
let before: ReturnType<typeof useSettings.getState>;

function memoryFiles(): CustomSoundFiles {
    const key = (pack: string, event: SoundEvent): string => `${pack}/${event}`;

    return {
        read: async (pack, event) => kept.get(key(pack, event)) ?? null,
        write: async (pack, event, file) => void kept.set(key(pack, event), file),
        remove: async (pack, event) => void kept.delete(key(pack, event))
    };
}

function sound(name: string, bytes = 10): File {
    return new File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
}

beforeEach(() => {
    kept = new Map();
    before = useSettings.getState();
    setCustomSoundFiles(memoryFiles());
    setSoundFileSeconds(async () => 0.4);
});

afterEach(() => {
    setCustomSoundFiles(null);
    setSoundFileSeconds(null);
    useSettings.getState().update({ soundPack: before.soundPack, customSoundPacks: before.customSoundPacks, projectSounds: before.projectSounds });
});

test('a new pack is the pack in use, takes a name and keeps a file per event', async () => {
    const id = addCustomSoundPack('My pack');

    renameCustomSoundPack(id, 'Office');
    expect(await setCustomSound(id, 'question', sound('ping.wav'))).toBeNull();

    expect(useSettings.getState().soundPack).toBe(id);
    expect(useSettings.getState().customSoundPacks).toEqual([{ id, name: 'Office', files: { question: 'ping.wav' } }]);
    expect(kept.get(`${id}/question`)?.size).toBe(10);
});

test('a file that is too large, too long or not a sound is refused and nothing is kept', async () => {
    const id = addCustomSoundPack('My pack');

    expect(await setCustomSound(id, 'alert', sound('song.wav', SOUND_FILE_MAX_BYTES + 1))).toBe('too-large');
    setSoundFileSeconds(async () => 5.1);
    expect(await setCustomSound(id, 'alert', sound('long.wav'))).toBe('too-long');
    setSoundFileSeconds(() => Promise.reject(new Error('no sound')));
    expect(await setCustomSound(id, 'alert', sound('notes.txt'))).toBe('unreadable');
    setSoundFileSeconds(async () => 5);
    expect(await soundFileRefusal(sound('edge.wav'))).toBeNull();
    expect(kept.size).toBe(0);
    expect(useSettings.getState().customSoundPacks[0]?.files).toEqual({});
});

test('deleting a pack removes its files and puts whatever used it back on the settings’ pack', async () => {
    const id = addCustomSoundPack('My pack');

    await setCustomSound(id, 'question', sound('ping.wav'));
    useSettings
        .getState()
        .update({ projectSounds: { 'local:atlas': { silent: true, pack: id }, 'local:other': { pack: id }, 'local:third': { pack: 'glass' } } });
    await removeCustomSoundPack(id);

    expect(kept.size).toBe(0);
    expect(useSettings.getState()).toMatchObject({
        soundPack: 'bar',
        customSoundPacks: [],
        projectSounds: { 'local:atlas': { silent: true }, 'local:third': { pack: 'glass' } }
    });
    expect(useSettings.getState().projectSounds['local:other']).toBeUndefined();
});
