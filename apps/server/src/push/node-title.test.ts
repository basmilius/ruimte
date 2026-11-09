import { describe, expect, test } from 'bun:test';
import { pushNodeTitle, type NodeTitleDeps } from './node-title.ts';

const TITLES: Record<string, string> = { lead: 'Lead', reviewer: 'Reviewer', checker: 'Checker', loop: 'Loop' };
const SHOWN = new Set(['lead']);

function deps(openers: Record<string, string>): NodeTitleDeps {
    return {
        titleFor: (id) => TITLES[id] ?? null,
        shows: (id) => SHOWN.has(id),
        openedBy: (id) => openers[id]
    };
}

describe('the title a push gives a node', () => {
    test('names a shown node by its own title', () => {
        expect(pushNodeTitle(deps({}), 'lead')).toBe('Lead');
    });

    test('names a hidden agent after the shown chat it is answered in, past hidden agents between', () => {
        expect(pushNodeTitle(deps({ reviewer: 'lead' }), 'reviewer')).toBe('Reviewer in Lead');
        expect(pushNodeTitle(deps({ checker: 'reviewer', reviewer: 'lead' }), 'checker')).toBe('Checker in Lead');
    });

    test('keeps the plain title when no shown chat is above it', () => {
        expect(pushNodeTitle(deps({ reviewer: 'routine:nightly' }), 'reviewer')).toBe('Reviewer');
        expect(pushNodeTitle(deps({ reviewer: 'checker', checker: 'reviewer' }), 'reviewer')).toBe('Reviewer');
        expect(pushNodeTitle(deps({}), 'gone')).toBeNull();
    });
});
