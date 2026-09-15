import { describe, expect, test } from 'bun:test';
import { decideRestart, decideStart, healthFrom, sameBuild, workFrom } from './decide';

const EXPECTED = { version: '0.1.0', build: '0.1.0-new' };

describe('decideRestart', () => {
    test('an idle machine is restarted without asking', () => {
        expect(decideRestart({ terminals: 0, agents: 0 })).toBe('restart');
    });

    test('a running terminal or agent is asked about', () => {
        expect(decideRestart({ terminals: 1, agents: 0 })).toBe('ask');
        expect(decideRestart({ terminals: 0, agents: 2 })).toBe('ask');
    });

    test('a daemon that cannot say what runs is asked about', () => {
        expect(decideRestart(null)).toBe('ask');
    });
});

describe('workFrom', () => {
    test('reads the counts and nothing else', () => {
        expect(workFrom({ terminals: 1, agents: 2 })).toEqual({ terminals: 1, agents: 2 });
        expect(workFrom({ terminals: -1, agents: 2 })).toBeNull();
        expect(workFrom('Not found')).toBeNull();
    });
});

describe('decideStart', () => {
    test('the same build answering is attached to', () => {
        expect(decideStart({ version: '0.1.0', build: '0.1.0-new' }, EXPECTED, true)).toBe('attach');
    });

    test('an older build answering is restarted onto the new binary', () => {
        expect(decideStart({ version: '0.0.9', build: '0.0.9-old' }, EXPECTED, true)).toBe('restart-service');
    });

    test('a daemon from before builds were stamped counts as older', () => {
        expect(decideStart({ version: '0.1.0', build: null }, EXPECTED, true)).toBe('restart-service');
    });

    test('nothing answering starts the service', () => {
        expect(decideStart(null, EXPECTED, true)).toBe('start-service');
    });

    test('with the service off nothing answering is spawned as before', () => {
        expect(decideStart(null, EXPECTED, false)).toBe('spawn');
    });

    test('with the service off whatever answers is used and left alone', () => {
        expect(decideStart({ version: '0.0.9', build: '0.0.9-old' }, EXPECTED, false)).toBe('attach-external');
        expect(decideStart({ version: '0.1.0', build: '0.1.0-new' }, EXPECTED, false)).toBe('attach-external');
    });
});

describe('sameBuild', () => {
    test('the build id decides when both sides have one, whatever the versions say', () => {
        expect(sameBuild({ version: '0.0.0', build: 'dev-a' }, { version: '0.0.0', build: 'dev-b' })).toBe(false);
        expect(sameBuild({ version: '0.0.0', build: 'dev-a' }, { version: '9.9.9', build: 'dev-a' })).toBe(true);
    });

    test('without an expected id the version decides', () => {
        expect(sameBuild({ version: '0.1.0', build: 'x' }, { version: '0.1.0', build: null })).toBe(true);
        expect(sameBuild({ version: '0.1.0', build: null }, { version: '0.1.1', build: null })).toBe(false);
    });
});

describe('healthFrom', () => {
    test('reads the version and the build', () => {
        expect(healthFrom({ ok: true, version: '0.1.0', build: 'b' })).toEqual({ version: '0.1.0', build: 'b' });
        expect(healthFrom({ ok: true, version: '0.1.0' })).toEqual({ version: '0.1.0', build: null });
    });

    test('anything else is no answer', () => {
        expect(healthFrom(null)).toBeNull();
        expect(healthFrom({ ok: false, version: '0.1.0' })).toBeNull();
        expect(healthFrom({ ok: true })).toBeNull();
    });
});
