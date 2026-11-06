import { describe, expect, test } from 'bun:test';
import type { GitPrCheck, GitPrThread } from '@ruimte/contracts';
import { groupChecks, mergeStateKey, threadBlock, visibleThreads } from './pr-view';

function thread(id: string, options: { bot?: boolean; resolved?: boolean } = {}): GitPrThread {
    return {
        id,
        path: 'src/a.ts',
        line: 3,
        resolved: options.resolved === true,
        outdated: false,
        comments: [{ author: options.bot === true ? 'copilot[bot]' : 'ada', bot: options.bot === true, body: `body ${id}`, url: 'u', createdAt: 't' }]
    };
}

describe('visibleThreads', () => {
    const threads = [thread('a'), thread('b', { bot: true }), thread('c', { resolved: true }), thread('d', { bot: true, resolved: true })];

    test('hides bots and resolved threads by default and counts each once', () => {
        const view = visibleThreads(threads, { showBots: false, showResolved: false });
        expect(view.shown.map((each) => each.id)).toEqual(['a']);
        expect(view.hiddenBots).toBe(1);
        expect(view.hiddenResolved).toBe(2);
    });

    test('shows everything when both switches are on', () => {
        const view = visibleThreads(threads, { showBots: true, showResolved: true });
        expect(view.shown).toHaveLength(4);
        expect(view.hiddenBots + view.hiddenResolved).toBe(0);
    });
});

describe('groupChecks', () => {
    test('skipped and neutral count as passed', () => {
        const checks: GitPrCheck[] = (['failure', 'pending', 'success', 'neutral', 'skipped'] as const).map((state) => ({ key: state, name: state, state }));
        const groups = groupChecks(checks);
        expect([groups.failed.length, groups.pending.length, groups.passed.length]).toEqual([1, 1, 3]);
    });
});

describe('mergeStateKey', () => {
    test('a conflict wins, a state it does not know is unknown', () => {
        expect(mergeStateKey({ mergeable: 'CONFLICTING', mergeState: 'BLOCKED' })).toBe('dirty');
        expect(mergeStateKey({ mergeable: 'MERGEABLE', mergeState: 'CLEAN' })).toBe('clean');
        expect(mergeStateKey({ mergeable: 'UNKNOWN', mergeState: 'FUTURE' })).toBe('unknown');
    });
});

describe('threadBlock', () => {
    test('names the place and quotes every comment in a fence', () => {
        const review = thread('a', { bot: true });
        review.comments.push({ author: 'ada', bot: false, body: '  Follow-up\nwith details.  ', url: 'reply', createdAt: 'later' });
        expect(threadBlock({ repo: 'o/r', number: 12 }, review)).toBe(
            'Review thread on o/r#12 at src/a.ts:3\n```\ncopilot[bot] (bot): body a\n\nada: Follow-up\nwith details.\n```'
        );
    });
});
