import { describe, expect, test } from 'bun:test';
import { settingsFrom } from './settings';

describe('a view an agent asks for', () => {
    test('is not followed until a person says so', () => {
        expect(settingsFrom({}).agentsShowViews).toBe(false);
        expect(settingsFrom({ accent: 'blue' }).agentsShowViews).toBe(false);
    });

    test('follows only on a stored true, never on whatever else is under the key', () => {
        expect(settingsFrom({ agentsShowViews: true }).agentsShowViews).toBe(true);
        expect(settingsFrom({ agentsShowViews: 'yes' as unknown as boolean }).agentsShowViews).toBe(false);
    });
});

describe('keeping the machine awake', () => {
    test('is off until a person turns it on, since a laptop that never sleeps is a decision', () => {
        expect(settingsFrom({}).agentsKeepAwake).toBe(false);
        expect(settingsFrom({ agentsShowViews: true }).agentsKeepAwake).toBe(false);
    });

    test('is on only for a stored true, never for whatever else is under the key', () => {
        expect(settingsFrom({ agentsKeepAwake: true }).agentsKeepAwake).toBe(true);
        expect(settingsFrom({ agentsKeepAwake: 1 as unknown as boolean }).agentsKeepAwake).toBe(false);
    });
});

describe('answering a permission here', () => {
    test('starts on: the terminal you would have answered in is the one thing the canvas moved away', () => {
        expect(settingsFrom({}).agentsApprovals).toBe(true);
        expect(settingsFrom({ agentsShowViews: true }).agentsApprovals).toBe(true);
    });

    test('is off for a stored false and for nothing else', () => {
        expect(settingsFrom({ agentsApprovals: false }).agentsApprovals).toBe(false);
        expect(settingsFrom({ agentsApprovals: 0 as unknown as boolean }).agentsApprovals).toBe(true);
    });
});

describe('being told a turn ended', () => {
    test('starts on: it only ever fires while you are elsewhere, which is when it is worth having', () => {
        expect(settingsFrom({}).agentsTurnNotify).toBe(true);
        expect(settingsFrom({ agentsKeepAwake: true }).agentsTurnNotify).toBe(true);
    });

    test('is off for a stored false and for nothing else', () => {
        expect(settingsFrom({ agentsTurnNotify: false }).agentsTurnNotify).toBe(false);
        expect(settingsFrom({ agentsTurnNotify: 0 as unknown as boolean }).agentsTurnNotify).toBe(true);
    });

    test('makes no sound until somebody asks for one', () => {
        expect(settingsFrom({}).agentsTurnSound).toBe(false);
        expect(settingsFrom({ agentsTurnNotify: true }).agentsTurnSound).toBe(false);
        expect(settingsFrom({ agentsTurnSound: true }).agentsTurnSound).toBe(true);
        expect(settingsFrom({ agentsTurnSound: 1 as unknown as boolean }).agentsTurnSound).toBe(false);
    });
});

describe('streaming replies', () => {
    test('starts a word at a time, and a mode that is stored is kept', () => {
        expect(settingsFrom({}).chatStreaming).toBe('words');
        expect(settingsFrom({ chatStreaming: 'blocks' }).chatStreaming).toBe('blocks');
        expect(settingsFrom({ chatStreaming: 'whole' }).chatStreaming).toBe('whole');
    });

    test('the switch it used to be reads as the mode it meant, and anything else as words', () => {
        const stored = (value: unknown) => settingsFrom({ chatStreaming: value as 'words' }).chatStreaming;
        expect(stored(true)).toBe('words');
        expect(stored(false)).toBe('whole');
        expect(stored(0)).toBe('words');
        expect(stored('paragraphs')).toBe('words');
    });
});

describe('swiping between pages', () => {
    test('starts on, the way every browser on macOS does it', () => {
        expect(settingsFrom({}).browserSwipe).toBe(true);
    });

    test('is off for a stored false and for nothing else', () => {
        expect(settingsFrom({ browserSwipe: false }).browserSwipe).toBe(false);
        expect(settingsFrom({ browserSwipe: 0 as unknown as boolean }).browserSwipe).toBe(true);
    });
});

describe('the rest of a stored blob', () => {
    test('a key that is there is kept, and a size out of range is pulled back into it', () => {
        const settings = settingsFrom({ fontSize: 99, filesShowHidden: true, browseStartFolder: '/Users/bas' });
        expect(settings.fontSize).toBe(20);
        expect(settings.filesShowHidden).toBe(true);
        expect(settings.browseStartFolder).toBe('/Users/bas');
    });
});
