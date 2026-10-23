import { describe, expect, test } from 'bun:test';
import {
    USAGE_COUNTERS,
    USAGE_DAY_MEASURES,
    USAGE_MAX_COUNT,
    USAGE_POINTS,
    USAGE_POINT_KINDS,
    UsageBatchSchema,
    isoWeekOf,
    usageDateProblem,
    type UsageDay
} from './index.ts';

const NOW = Date.parse('2026-10-16T09:30:00Z');

function day(overrides: Partial<UsageDay> = {}): UsageDay {
    return {
        date: '2026-10-15',
        version: '0.19.0',
        platform: 'darwin',
        arch: 'arm64',
        launcher: 'service',
        signedIn: true,
        firstThisWeek: true,
        firstThisMonth: false,
        cohortWeek: '2026-W40',
        counts: {},
        ...overrides
    };
}

function issuesOf(body: unknown): string[] {
    const parsed = UsageBatchSchema.safeParse(body);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('the usage fields', () => {
    test('no field is named twice, and the measures of a day lead its point', () => {
        const fields = USAGE_POINT_KINDS.flatMap((kind) => [...USAGE_POINTS[kind]]);
        expect(new Set(fields).size).toBe(fields.length);
        expect(USAGE_POINTS.day.slice(0, USAGE_DAY_MEASURES.length)).toEqual([...USAGE_DAY_MEASURES]);
        expect(USAGE_COUNTERS.length).toBe(fields.length - USAGE_DAY_MEASURES.length);
    });
});

describe('a usage batch', () => {
    test('takes a full day and leaves out what is absent', () => {
        const counts = Object.fromEntries(USAGE_COUNTERS.map((counter) => [counter, 1]));
        expect(issuesOf({ days: [day({ counts, startupMs: 1200 })] })).toEqual([]);
        expect(issuesOf({ days: [day()] })).toEqual([]);
    });

    test('refuses keys it does not know, at every level', () => {
        expect(issuesOf({ days: [day()], installId: 'x' })).toEqual(['']);
        expect(issuesOf({ days: [{ ...day(), machine: 'm' }] })).toEqual(['days.0']);
        expect(issuesOf({ days: [day({ counts: { projectsOpened: 1, projectNames: 2 } as never })] })).toEqual(['days.0.counts']);
    });

    test('refuses counts that are negative, fractional or above the cap', () => {
        expect(issuesOf({ days: [day({ counts: { projectsOpened: -1 } })] })).toEqual(['days.0.counts.projectsOpened']);
        expect(issuesOf({ days: [day({ counts: { projectsOpened: 1.5 } })] })).toEqual(['days.0.counts.projectsOpened']);
        expect(issuesOf({ days: [day({ counts: { projectsOpened: USAGE_MAX_COUNT + 1 } })] })).toEqual(['days.0.counts.projectsOpened']);
        expect(issuesOf({ days: [day({ startupMs: 0 })] })).toEqual(['days.0.startupMs']);
    });

    test('holds one to seven distinct days', () => {
        const days = Array.from({ length: 8 }, (_, i) => day({ date: `2026-10-0${i + 1}` }));
        expect(issuesOf({ days: days.slice(0, 7) })).toEqual([]);
        expect(issuesOf({ days })).toEqual(['days']);
        expect(issuesOf({ days: [] })).toEqual(['days']);
        expect(issuesOf({ days: [day(), day()] })).toEqual(['days']);
    });

    test('refuses a date, version, week or platform of another shape', () => {
        expect(issuesOf({ days: [day({ date: '2026-02-30' })] })).toEqual(['days.0.date']);
        expect(issuesOf({ days: [day({ version: 'main' })] })).toEqual(['days.0.version']);
        expect(issuesOf({ days: [day({ cohortWeek: '2026-W54' })] })).toEqual(['days.0.cohortWeek']);
        expect(issuesOf({ days: [day({ cohortWeek: '2026-W43' })] })).toEqual(['days.0.cohortWeek']);
        expect(issuesOf({ days: [day({ platform: 'plan9' as never })] })).toEqual(['days.0.platform']);
        expect(issuesOf({ days: [day({ version: '0.0.0-test' })] })).toEqual([]);
    });
});

describe('the days the address book takes', () => {
    test('today and the eight days before it, nothing later or older', () => {
        expect(usageDateProblem('2026-10-16', NOW)).toBeNull();
        expect(usageDateProblem('2026-10-08', NOW)).toBeNull();
        expect(usageDateProblem('2026-10-07', NOW)).not.toBeNull();
        expect(usageDateProblem('2026-10-17', NOW)).not.toBeNull();
    });
});

describe('the ISO week', () => {
    test('starts on Monday and puts the first Thursday in week 1', () => {
        expect(isoWeekOf('2026-10-15')).toBe('2026-W42');
        expect(isoWeekOf('2026-10-12')).toBe('2026-W42');
        expect(isoWeekOf('2026-10-11')).toBe('2026-W41');
        expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
        expect(isoWeekOf('2025-12-29')).toBe('2026-W01');
    });
});
