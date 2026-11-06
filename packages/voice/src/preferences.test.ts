import { describe, expect, test } from 'bun:test';
import { parseOpenAiLivePreferences } from './preferences.ts';

describe('parseOpenAiLivePreferences', () => {
    test('accepts a listed language and built-in Live voice', () => {
        expect(parseOpenAiLivePreferences({ language: 'ja', voice: 'cedar' })).toEqual({ language: 'ja', voice: 'cedar' });
    });

    test('rejects values outside the settings protocol', () => {
        expect(parseOpenAiLivePreferences(null)).toBeNull();
        expect(parseOpenAiLivePreferences({ language: 'klingon', voice: 'marin' })).toBeNull();
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'robot' })).toBeNull();
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'willow' })).toBeNull();
    });

    test('keeps the domains a page names, drops one this build does not know, and refuses a list that is no list', () => {
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'marin', domains: ['workspace', 'future', 'developer'] })).toEqual({
            language: 'nl',
            voice: 'marin',
            domains: ['workspace', 'developer']
        });
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'marin', domains: 'developer' })).toBeNull();
    });

    test('drops a key the page was never meant to send', () => {
        expect(parseOpenAiLivePreferences({ language: 'nl', voice: 'marin', key: 'sk-x' })).toEqual({ language: 'nl', voice: 'marin' });
    });
});
