import { afterEach, describe, expect, test } from 'bun:test';
import { formatBytes, formatDecimal, formatMoney, formatNumber, formatPercent, formatTokens } from '@/format/number';
import { FORMAT_SYSTEM } from '@/format/regions';
import { useSettings } from '@/state/settings';

const inRegion = (region: string): void => {
    useSettings.getState().update({ formatRegion: region });
};

afterEach(() => {
    inRegion(FORMAT_SYSTEM);
});

describe('a number', () => {
    test('groups and separates the way the region writes one', () => {
        inRegion('nl-NL');
        expect(formatNumber(1_234_567)).toBe('1.234.567');
        expect(formatDecimal(1.5)).toBe('1,5');
        inRegion('en-US');
        expect(formatNumber(1_234_567)).toBe('1,234,567');
        expect(formatDecimal(1.5)).toBe('1.5');
    });

    test('keeps the decimal only where it still says something', () => {
        inRegion('nl-NL');
        expect(formatPercent(8.5)).toBe('8,5%');
        expect(formatPercent(42.4)).toBe('42%');
    });
});

describe('a token count', () => {
    test('is read as a size, to one decimal until the decimal stops saying anything', () => {
        inRegion('en-US');
        expect(formatTokens(640)).toBe('640');
        expect(formatTokens(412_000)).toBe('412K');
        expect(formatTokens(1_240_000)).toBe('1.2M');
        expect(formatTokens(11_900_000)).toBe('12M');
    });

    test('writes its decimal the way the region does', () => {
        inRegion('nl-NL');
        expect(formatTokens(1_240_000)).toBe('1,2M');
    });
});

describe('an amount of money', () => {
    // A Dutch region writes a dollar as `US$` unless the symbol is asked for narrow, which is a
    // currency lesson nobody wants in a table of prices. The space after it is the one that never
    // breaks, which is what keeps a symbol and its amount on the same line of a narrow column.
    test('wears the plain symbol of its currency in every region', () => {
        inRegion('nl-NL');
        expect(formatMoney(5480.96, 'USD')).toBe('$\u00a05.480,96');
        expect(formatMoney(5480.96, 'EUR')).toBe('€\u00a05.480,96');
        inRegion('en-US');
        expect(formatMoney(5480.96, 'USD')).toBe('$5,480.96');
    });

    test('takes more decimals where two of them would read as zero', () => {
        inRegion('nl-NL');
        expect(formatMoney(0.0032, 'USD', 4)).toBe('$\u00a00,0032');
    });
});

describe('a size', () => {
    test('carries one decimal under ten and none above it', () => {
        inRegion('nl-NL');
        expect(formatBytes(1536)).toBe('1,5 KB');
        expect(formatBytes(1024 * 1024 * 42)).toBe('42 MB');
    });

    test('is whole bytes below a kilobyte, whatever the region', () => {
        inRegion('en-US');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1536, true)).toBe('2 KB');
    });
});
