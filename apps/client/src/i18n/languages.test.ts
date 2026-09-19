import { describe, expect, test } from 'bun:test';
import { FALLBACK_LANGUAGE, LANGUAGE_SYSTEM, languageFrom, languageOf } from '@/i18n/languages';

describe('a stored language', () => {
    test('is kept when this version speaks it', () => {
        expect(languageFrom('nl')).toBe('nl');
        expect(languageFrom('en')).toBe('en');
    });

    test('lands on the system when it is anything else', () => {
        expect(languageFrom('de')).toBe(LANGUAGE_SYSTEM);
        expect(languageFrom(undefined)).toBe(LANGUAGE_SYSTEM);
    });
});

describe('what the system asks for', () => {
    test('is read as a language and never as a country', () => {
        expect(languageOf(['nl-BE', 'fr-BE'])).toBe('nl');
        expect(languageOf(['en-GB'])).toBe('en');
        expect(languageOf(['NL'])).toBe('nl');
    });

    test('walks down the list until it finds one we speak', () => {
        expect(languageOf(['de-DE', 'fr-FR', 'nl-NL'])).toBe('nl');
    });

    // Half a translation reads worse than none, so a language we do not have is not answered with
    // the nearest one: it is left to the fallback.
    test('is nothing when we speak none of them', () => {
        expect(languageOf(['de-DE', 'ja-JP'])).toBeNull();
        expect(languageOf([])).toBeNull();
        expect(FALLBACK_LANGUAGE).toBe('en');
    });
});
