import { describe, expect, test } from 'bun:test';
import { USAGE_MAX_COUNT, USAGE_POINTS, USAGE_POINT_KINDS, UsageBatchSchema, isoWeekOf, type UsageDay } from './index.ts';

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
    test('no legacy field is named twice', () => {
        const fields = USAGE_POINT_KINDS.flatMap((kind) => [...USAGE_POINTS[kind]]);
        expect(new Set(fields).size).toBe(fields.length);
    });
});

describe('a usage batch', () => {
    test('takes the frozen pre-0.22 counters and leaves out what is absent', () => {
        const counts = {
            projectsOpened: 1,
            terminalsStarted: 1,
            agentsDelegated: 1,
            teamsDelegated: 1,
            launchesRun: 1,
            worktreeMerges: 1,
            clientsDesktop: 1,
            clientsIos: 1,
            clientsStation: 1,
            clientsPeer: 1,
            browserActions: 1,
            deviceActions: 1,
            databaseActions: 1,
            computerActions: 1,
            viewsCanvas: 1,
            viewsChat: 1,
            viewsTerminal: 1,
            viewsBrowser: 1,
            viewsDevice: 1,
            viewsDrawing: 1,
            viewsDiagram: 1,
            viewsFile: 1,
            viewsDatabase: 1,
            chatsClaude: 1,
            chatsCodex: 1,
            chatsGemini: 1,
            chatsCopilot: 1,
            chatsApple: 1,
            turnsClaude: 1,
            turnsCodex: 1,
            turnsGemini: 1,
            turnsCopilot: 1,
            turnsApple: 1,
            verbsRead: 1,
            verbsTask: 1,
            verbsMessage: 1,
            verbsAgent: 1,
            verbsCanvas: 1,
            verbsBrowser: 1,
            verbsDevice: 1,
            verbsDatabase: 1,
            verbsComputer: 1,
            verbsWorktree: 1,
            verbsLaunches: 1,
            verbsSecret: 1,
            verbsLanguage: 1
        };
        const full = { days: [day({ counts, startupMs: 1200 })] };
        expect(UsageBatchSchema.parse(full)).toEqual(full);
        const sparse = { days: [day()] };
        expect(UsageBatchSchema.parse(sparse)).toEqual(sparse);
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

describe('the ISO week', () => {
    test('starts on Monday and puts the first Thursday in week 1', () => {
        expect(isoWeekOf('2026-10-15')).toBe('2026-W42');
        expect(isoWeekOf('2026-10-12')).toBe('2026-W42');
        expect(isoWeekOf('2026-10-11')).toBe('2026-W41');
        expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
        expect(isoWeekOf('2025-12-29')).toBe('2026-W01');
    });
});
