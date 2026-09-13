import { describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';

import { callerName, showViewNotice } from './show-view';

const canvas = (id: string, nodes: { id: string; title: string }[]): ProjectView => ({
    kind: 'canvas',
    id,
    name: id,
    nodes: nodes.map((node) => ({ ...node, kind: 'terminal' as const, x: 0, y: 0, w: 100, h: 80 })),
    texts: [],
    edges: [],
    layouts: []
});

describe('callerName', () => {
    const views: ProjectView[] = [canvas('main', [{ id: 'term-1', title: 'Refactor' }]), { kind: 'chat', id: 'chat-1', name: 'Planner', node: {} }];

    test('a node on a canvas is its title, a session of its own the name of its view', () => {
        expect(callerName(views, 'term-1')).toBe('Refactor');
        expect(callerName(views, 'chat-1')).toBe('Planner');
    });

    test('an id this client has not got yet has no name, and the toast says so in its own words', () => {
        expect(callerName(views, 'term-9')).toBeNull();
        expect(showViewNotice({ agent: null, view: 'Board', follow: true, alreadyThere: false }).title).toBe('An agent showed Board');
    });
});

describe('showViewNotice', () => {
    test('following says what moved and offers the way back', () => {
        const notice = showViewNotice({ agent: 'Refactor', view: 'Board', follow: true, alreadyThere: false });
        expect(notice.title).toBe('Refactor showed Board');
        expect(notice.where).toBe('toast');
        expect(notice.back).toBe(true);
    });

    test('with the setting off nothing moves, so it is the banner that asks', () => {
        const notice = showViewNotice({ agent: 'Refactor', view: 'Board', follow: false, alreadyThere: false });
        expect(notice.title).toBe('Refactor asked you to look at Board');
        expect(notice.where).toBe('banner');
        expect(notice.back).toBe(false);
        // The banner is one row, so everything it says has to be in that one line.
        expect(notice.description).toBeUndefined();
    });

    test('the view already in front reads the same either way, and carries no button at all', () => {
        for (const follow of [true, false]) {
            const notice = showViewNotice({ agent: 'Refactor', view: 'Board', follow, alreadyThere: true });
            expect(notice.title).toBe('Refactor pointed at Board');
            expect(notice.where).toBe('toast');
            expect(notice.back).toBe(false);
        }
    });
});
