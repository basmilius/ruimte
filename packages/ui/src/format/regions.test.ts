import { describe, expect, test } from 'bun:test';
import { FORMAT_LANGUAGE, FORMAT_REGION_CHOICES, formatRegionFrom, regionName } from './regions.ts';

describe('a stored region', () => {
    test('is kept when this version offers it', () => {
        expect(formatRegionFrom('nl-NL')).toBe('nl-NL');
        expect(formatRegionFrom('system')).toBe('system');
    });

    test('lands on the language when it is anything else', () => {
        expect(formatRegionFrom('xx-YY')).toBe(FORMAT_LANGUAGE);
        expect(formatRegionFrom(undefined)).toBe(FORMAT_LANGUAGE);
        expect(formatRegionFrom(42)).toBe(FORMAT_LANGUAGE);
    });

    // Following the language is where everyone starts, so picking Dutch writes Dutch dates without
    // a second trip through the settings.
    test('offers the language first and the system after it', () => {
        expect(FORMAT_REGION_CHOICES[0]).toBe(FORMAT_LANGUAGE);
        expect(FORMAT_REGION_CHOICES[1]).toBe('system');
    });
});

describe('the name of a region', () => {
    test('is its country, in the language asked for', () => {
        expect(regionName('nl-NL', 'en')).toBe('Netherlands');
        expect(regionName('en-GB', 'nl')).toBe('Verenigd Koninkrijk');
    });
});
