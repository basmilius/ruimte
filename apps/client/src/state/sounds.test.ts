import { describe, expect, test } from 'bun:test';
import { customSoundPacksFrom, soundFor, withProjectSounds, type SoundSettings } from './sounds';

const OWN = { id: 'custom-1', name: 'Mine', files: { question: 'ping.wav' } };

function settings(patch: Partial<SoundSettings> = {}): SoundSettings {
    return {
        soundPack: 'bar',
        soundEvents: { question: true, alert: true, limit: false, error: true, finished: true },
        customSoundPacks: [OWN],
        projectSounds: {},
        ...patch
    };
}

describe('soundFor', () => {
    test('an event that is off makes no sound', () => {
        expect(soundFor(settings(), 'limit', 'local:atlas')).toBeNull();
    });

    test('an event that is on sounds in the pack of the settings', () => {
        expect(soundFor(settings(), 'question', 'local:atlas')).toEqual({ pack: 'bar', event: 'question' });
        expect(soundFor(settings(), 'alert', null)).toEqual({ pack: 'bar', event: 'alert' });
    });

    test('a project with a pack of its own sounds in that one, and another project does not', () => {
        const chosen = settings({ projectSounds: { 'local:atlas': { pack: 'glass' } } });

        expect(soundFor(chosen, 'finished', 'local:atlas')).toEqual({ pack: 'glass', event: 'finished' });
        expect(soundFor(chosen, 'finished', 'local:other')).toEqual({ pack: 'bar', event: 'finished' });
    });

    test('a silent project makes no sound, whatever its pack', () => {
        expect(soundFor(settings({ projectSounds: { 'local:atlas': { silent: true, pack: 'glass' } } }), 'question', 'local:atlas')).toBeNull();
    });

    test('a pack of a person’s own plays its file, and for an event without one what the settings play', () => {
        const project = settings({ soundPack: 'glass', projectSounds: { 'local:atlas': { pack: OWN.id } } });

        expect(soundFor(project, 'question', 'local:atlas')).toEqual({ pack: OWN.id, event: 'question' });
        expect(soundFor(project, 'finished', 'local:atlas')).toEqual({ pack: 'glass', event: 'finished' });
    });

    test('the settings’ own pack without a file for an event plays the default pack', () => {
        expect(soundFor(settings({ soundPack: OWN.id }), 'finished', null)).toEqual({ pack: 'bar', event: 'finished' });
    });

    test('an event turned off in a pack is silent there, with or without a file, and also for a project that falls back on it', () => {
        const other = { id: 'custom-2', name: 'Other', files: {} };
        const muted = settings({
            soundPack: OWN.id,
            customSoundPacks: [{ ...OWN, off: ['question', 'finished'] }, other],
            projectSounds: { 'local:atlas': { pack: other.id } }
        });

        expect(soundFor(muted, 'question', null)).toBeNull();
        expect(soundFor(muted, 'finished', null)).toBeNull();
        expect(soundFor(muted, 'finished', 'local:atlas')).toBeNull();
        expect(soundFor(muted, 'error', 'local:atlas')).toEqual({ pack: 'bar', event: 'error' });
    });
});

describe('customSoundPacksFrom', () => {
    test('keeps the events turned off, and leaves the list out of a pack that has none', () => {
        expect(
            customSoundPacksFrom([
                { ...OWN, off: ['finished', 'nonsense'] },
                { id: 'custom-2', name: 'Other', files: {}, off: [] }
            ])
        ).toEqual([
            { ...OWN, off: ['finished'] },
            { id: 'custom-2', name: 'Other', files: {} }
        ]);
    });
});

describe('withProjectSounds', () => {
    test('a project that follows the settings in everything leaves the map', () => {
        const chosen = withProjectSounds({}, 'local:atlas', { silent: true, pack: 'glass' });

        expect(chosen).toEqual({ 'local:atlas': { silent: true, pack: 'glass' } });
        expect(withProjectSounds(chosen, 'local:atlas', { silent: false, pack: undefined })).toEqual({});
    });
});
