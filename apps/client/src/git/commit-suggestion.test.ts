import { expect, test } from 'bun:test';
import { CommitSuggestion } from './commit-suggestion';

const draft = { key: 'project', message: '', source: 'repo:staged-file' };

test('a suggestion applies only to an untouched draft', () => {
    const flow = new CommitSuggestion();
    flow.observe(draft);
    const request = flow.begin();
    expect(flow.finish(request)).toBe('apply');
    flow.observe({ ...draft, message: 'My message' });
    expect(flow.finish(request)).toBe('offer');
    flow.observe(draft);
    expect(flow.finish(request)).toBe('offer');
});

test('changing staged files, projects, committing, cancelling and newer requests retire suggestions', () => {
    for (const next of [
        { ...draft, key: 'other' },
        { ...draft, source: 'repo:other-file' }
    ]) {
        const flow = new CommitSuggestion();
        flow.observe(draft);
        const request = flow.begin();
        flow.observe(next);
        expect(flow.finish(request)).toBe('stale');
    }
    const flow = new CommitSuggestion();
    flow.observe(draft);
    const first = flow.begin();
    const second = flow.begin();
    expect(flow.finish(first)).toBe('stale');
    flow.cancel();
    expect(flow.finish(second)).toBe('stale');
});

test('an old completion cannot retire a newer request, and even a reverted edit is protected', () => {
    const flow = new CommitSuggestion();
    flow.observe({ ...draft, version: 0 });
    const old = flow.begin();
    flow.observe({ ...draft, source: 'other', version: 0 });
    const current = flow.begin();
    expect(flow.finish(old, { message: 'Old', version: 1 })).toBe('stale');
    expect(flow.finish(current, { message: '', version: 0 })).toBe('apply');
    expect(flow.finish(current, { message: '', version: 2 })).toBe('offer');
});
