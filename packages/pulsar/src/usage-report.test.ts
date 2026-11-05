import { describe, expect, test } from 'bun:test';
import {
    USAGE_REPORT_COUNTERS,
    USAGE_REPORT_MAX_COUNTERS,
    UsageReportBatchSchema,
    usageModelFamilyOf,
    usageProviderOf,
    usageReportCounterOfV1,
    type UsageReportDay
} from './index.ts';

function day(overrides: Partial<UsageReportDay> = {}): UsageReportDay {
    return {
        date: '2026-10-15',
        version: '0.22.0',
        platform: 'darwin',
        arch: 'arm64',
        launcher: 'desktop',
        signedIn: true,
        firstThisWeek: false,
        firstThisMonth: false,
        cohortWeek: '2026-W41',
        startupMs: 900,
        counts: { 'chats.claude': 2, 'turns.model.opus': 7, 'verbs.agent': 1 },
        timings: { 'firstTokenMs.claude': 1400, terminalAttachMs: 85 },
        ...overrides
    };
}

describe('the usage report', () => {
    test('takes counters and timings from the allow-list', () => {
        expect(UsageReportBatchSchema.safeParse({ days: [day()] }).success).toBe(true);
    });

    test('refuses a name outside the allow-list, at counts and at timings', () => {
        expect(UsageReportBatchSchema.safeParse({ days: [day({ counts: { 'chats.my-own-agent': 1 } as UsageReportDay['counts'] })] }).success).toBe(false);
        expect(UsageReportBatchSchema.safeParse({ days: [day({ timings: { lunchMs: 5 } as UsageReportDay['timings'] })] }).success).toBe(false);
        expect(UsageReportBatchSchema.safeParse({ days: [day({ timings: { startupMs: 900 } as UsageReportDay['timings'] })] }).success).toBe(false);
        expect(UsageReportBatchSchema.safeParse({ days: [{ ...day(), extra: true }] }).success).toBe(false);
    });

    test('refuses a zero, which a machine leaves out', () => {
        expect(UsageReportBatchSchema.safeParse({ days: [day({ counts: { 'chats.claude': 0 } })] }).success).toBe(false);
    });

    test('names every counter once, in a dimension where it has a dot', () => {
        expect(new Set(USAGE_REPORT_COUNTERS).size).toBe(USAGE_REPORT_COUNTERS.length);
        expect(USAGE_REPORT_COUNTERS).toContain('chats.grok');
        expect(USAGE_REPORT_COUNTERS).toContain('turns.mode.fullAccess');
        expect(USAGE_REPORT_COUNTERS).toContain('turns.mode.plan');
        expect(USAGE_REPORT_COUNTERS).toContain('connectFailures.timeout');
        expect(USAGE_REPORT_COUNTERS.length).toBeLessThanOrEqual(USAGE_REPORT_MAX_COUNTERS);
        // Observatory's rule for a counter name.
        expect(USAGE_REPORT_COUNTERS.every((name) => /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(name))).toBe(true);
    });
});

describe('the fixture Observatory builds against', () => {
    test('is a report, two days of it', async () => {
        const fixture: unknown = await Bun.file(new URL('../fixtures/usage.json', import.meta.url)).json();
        const parsed = UsageReportBatchSchema.safeParse(fixture);
        expect(parsed.success).toBe(true);
        expect(parsed.data?.days.map((day) => day.launcher).sort()).toEqual(['desktop', 'service']);
    });
});

describe('what a turn and a chat are counted under', () => {
    test('a model id as its family, never the id itself', () => {
        expect(usageModelFamilyOf('claude-opus-5-5')).toBe('opus');
        expect(usageModelFamilyOf('claude-fable-5-1')).toBe('fable');
        expect(usageModelFamilyOf('gpt-5-codex')).toBe('codex');
        expect(usageModelFamilyOf('gpt-5.2')).toBe('gpt');
        expect(usageModelFamilyOf('o3')).toBe('gpt');
        expect(usageModelFamilyOf('deepseek/deepseek-r1')).toBe('deepseek');
        expect(usageModelFamilyOf('my-finetune')).toBe('other');
    });

    test('a provider this list does not know as other', () => {
        expect(usageProviderOf('grok')).toBe('grok');
        expect(usageProviderOf('gemini')).toBe('other');
    });
});

describe('a counter an older daemon kept', () => {
    test('takes its report name, with Gemini in other and a verb group dropped', () => {
        expect(usageReportCounterOfV1('chatsClaude')).toBe('chats.claude');
        expect(usageReportCounterOfV1('chatsGemini')).toBe('chats.other');
        expect(usageReportCounterOfV1('turnsApple')).toBe('turns.apple');
        expect(usageReportCounterOfV1('viewsChat')).toBe('views.chat');
        expect(usageReportCounterOfV1('terminalsStarted')).toBe('terminals.started');
        expect(usageReportCounterOfV1('verbsRead')).toBeNull();
    });
});
