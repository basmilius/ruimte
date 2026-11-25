import { describe, expect, test } from 'bun:test';
import { announcementsFrom, customSoundPacksFrom, projectSoundsFrom, soundFor, withProjectSounds, type SoundSettings } from './sounds';

const OWN = { id: 'custom-1', name: 'Mine', files: { question: 'ping.wav' } };

function settings(patch: Partial<SoundSettings> = {}): SoundSettings {
    return { soundPack: 'marimba-low', customSoundPacks: [OWN], projectSounds: {}, ...patch };
}

describe('soundFor', () => {
    test('an event sounds in the pack of the settings', () => {
        expect(soundFor(settings(), 'question', 'local:atlas')).toEqual({ pack: 'marimba-low', event: 'question' });
        expect(soundFor(settings(), 'alert', null)).toEqual({ pack: 'marimba-low', event: 'alert' });
    });

    test('the pack that plays nothing is silent, for the settings and for a project that picks it', () => {
        expect(soundFor(settings({ soundPack: 'none' }), 'question', 'local:atlas')).toBeNull();
        expect(soundFor(settings({ projectSounds: { 'local:atlas': { pack: 'none' } } }), 'question', 'local:atlas')).toBeNull();
        expect(soundFor(settings({ soundPack: 'none', projectSounds: { 'local:atlas': { pack: 'kalimba' } } }), 'question', 'local:atlas')).toEqual({
            pack: 'kalimba',
            event: 'question'
        });
    });

    test('a pack of a person’s own without a file is silent while the settings play nothing', () => {
        const project = settings({ soundPack: 'none', projectSounds: { 'local:atlas': { pack: OWN.id } } });

        expect(soundFor(project, 'question', 'local:atlas')).toEqual({ pack: OWN.id, event: 'question' });
        expect(soundFor(project, 'finished', 'local:atlas')).toBeNull();
    });

    test('a project with a pack of its own sounds in that one, and another project does not', () => {
        const chosen = settings({ projectSounds: { 'local:atlas': { pack: 'kalimba' } } });

        expect(soundFor(chosen, 'finished', 'local:atlas')).toEqual({ pack: 'kalimba', event: 'finished' });
        expect(soundFor(chosen, 'finished', 'local:other')).toEqual({ pack: 'marimba-low', event: 'finished' });
    });

    test('a pack of a person’s own plays its file, and for an event without one what the settings play', () => {
        const project = settings({ soundPack: 'kalimba', projectSounds: { 'local:atlas': { pack: OWN.id } } });

        expect(soundFor(project, 'question', 'local:atlas')).toEqual({ pack: OWN.id, event: 'question' });
        expect(soundFor(project, 'finished', 'local:atlas')).toEqual({ pack: 'kalimba', event: 'finished' });
    });

    test('the settings’ own pack without a file for an event plays the default pack', () => {
        expect(soundFor(settings({ soundPack: OWN.id }), 'finished', null)).toEqual({ pack: 'marimba-low', event: 'finished' });
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
        expect(soundFor(muted, 'error', 'local:atlas')).toEqual({ pack: 'marimba-low', event: 'error' });
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
    test('a project that follows the settings leaves the map', () => {
        const chosen = withProjectSounds({}, 'local:atlas', { pack: 'kalimba' });

        expect(chosen).toEqual({ 'local:atlas': { pack: 'kalimba' } });
        expect(withProjectSounds(chosen, 'local:atlas', {})).toEqual({});
    });
});

describe('projectSoundsFrom', () => {
    test('a project that was silent plays nothing, whatever pack it had, and a pack of their own nobody has follows the settings', () => {
        expect(
            projectSoundsFrom(
                { 'local:a': { pack: 'custom-gone' }, 'local:b': { silent: true, pack: 'kalimba' }, 'local:c': {}, 'local:d': { pack: 'tine' } },
                []
            )
        ).toEqual({ 'local:b': { pack: 'none' }, 'local:d': { pack: 'tine' } });
    });

    test('a built-in pack that is gone becomes the default pack', () => {
        expect(projectSoundsFrom({ 'local:a': { pack: 'glass' } }, [])).toEqual({ 'local:a': { pack: 'marimba-low' } });
    });
});

describe('announcementsFrom', () => {
    const OFF = { question: false, alert: false, limit: false, error: false, finished: false };

    test('a blob that holds nothing notifies of a question and an alert, without a sound', () => {
        expect(announcementsFrom({}, [])).toEqual({ notifyEvents: { ...OFF, question: true, alert: true }, soundPack: 'none' });
    });

    test('a blob from before keeps what it did: the two alerts always notified, the rest while its sound was on', () => {
        expect(announcementsFrom({ soundPack: 'log', soundEvents: { ...OFF, question: true, limit: true } }, [])).toEqual({
            notifyEvents: { ...OFF, question: true, alert: true, limit: true },
            soundPack: 'log'
        });
        expect(announcementsFrom({ soundPack: 'log', soundEvents: OFF }, [])).toEqual({
            notifyEvents: { ...OFF, question: true, alert: true },
            soundPack: 'none'
        });
        expect(announcementsFrom({ agentsTurnSound: true }, []).soundPack).toBe('marimba-low');
    });

    test('the switches a person set win over what was stored before them, also with every one off', () => {
        expect(announcementsFrom({ notifyEvents: OFF, soundPack: 'kalimba', soundEvents: { ...OFF, finished: true } }, [])).toEqual({
            notifyEvents: OFF,
            soundPack: 'kalimba'
        });
        expect(announcementsFrom({ notifyEvents: { ...OFF, finished: true }, soundPack: 'glass' }, []).soundPack).toBe('marimba-low');
    });
});
