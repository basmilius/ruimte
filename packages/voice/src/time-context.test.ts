import { describe, expect, test } from 'bun:test';
import { timeContext } from './time-context.ts';

const NOW = Date.UTC(2026, 9, 21, 22, 30, 0);

describe('timeContext', () => {
    test('reads the clock of the zone the person is in', () => {
        expect(timeContext(NOW, 'Europe/Amsterdam')).toBe(
            'User local date and time: Thursday, 22 October 2026 at 00:30:00 CEST. IANA time zone: Europe/Amsterdam. UTC time: 2026-10-21T22:30:00.000Z.'
        );
    });

    test('shows a zone this runtime does not know in UTC and says so', () => {
        const context = timeContext(NOW, 'Mars/Olympus');

        expect(context).toContain('IANA time zone: unknown (Mars/Olympus), shown in UTC.');
        expect(context).toContain('Wednesday, 21 October 2026 at 22:30:00 UTC');
    });

    test('names a caller that does not know its zone as unknown', () => {
        expect(timeContext(NOW, null)).toContain('IANA time zone: unknown. UTC time: 2026-10-21T22:30:00.000Z.');
    });

    test('cuts a zone name that is too long to be one', () => {
        expect(timeContext(NOW, 'x'.repeat(200))).toContain(`unknown (${'x'.repeat(64)}), shown in UTC`);
    });
});
