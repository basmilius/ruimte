import { describe, expect, test } from 'bun:test';
import { soundFor, withProjectSounds, type SoundSettings } from './sounds';

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

    test('a pack of a person’s own sounds only for the events it has a file for', () => {
        const own = settings({ soundPack: OWN.id });

        expect(soundFor(own, 'question', null)).toEqual({ pack: OWN.id, event: 'question' });
        expect(soundFor(own, 'finished', null)).toBeNull();
    });
});

describe('withProjectSounds', () => {
    test('a project that follows the settings in everything leaves the map', () => {
        const chosen = withProjectSounds({}, 'local:atlas', { silent: true, pack: 'glass' });

        expect(chosen).toEqual({ 'local:atlas': { silent: true, pack: 'glass' } });
        expect(withProjectSounds(chosen, 'local:atlas', { silent: false, pack: undefined })).toEqual({});
    });
});
