import { describe, expect, test } from 'bun:test';
import type { ContextSource } from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { withForkOrigin } from './fork-origin.ts';

const readers = (places: Record<string, string | null>, forks: Record<string, string> = { fork: 'lead' }) => ({
    forkedFrom: (id: string) => forks[id] ?? null,
    locate: (id: string): IndexedPlace | null => (id in places ? { projectId: 'p1', folder: '/work', canvasId: places[id]! } : null),
    titleFor: (id: string) => (id === 'lead' ? 'Lexer' : null)
});

const text: ContextSource = { id: 'text-1', kind: 'text', title: 'Plan', text: 'plan' };

describe('withForkOrigin', () => {
    test('a fork that is a view reads its original, a view or a node alike', () => {
        const origin: ContextSource = { id: 'lead', kind: 'chat', title: 'Lexer' };
        expect(withForkOrigin('fork', [], readers({ lead: null, fork: null }))).toEqual([origin]);
        expect(withForkOrigin('fork', [text], readers({ lead: 'main', fork: null }))).toEqual([text, origin]);
    });

    test('a node fork on the canvas of its original is left to the edge, whether or not it is still drawn', () => {
        expect(withForkOrigin('fork', [], readers({ lead: 'main', fork: 'main' }))).toEqual([]);
    });

    test('nothing is added for a chat that is no fork, an original that is gone, or one the edge already carries', () => {
        expect(withForkOrigin('fork', [], readers({ lead: null, fork: null }, {}))).toEqual([]);
        expect(withForkOrigin('fork', [], readers({ fork: null }))).toEqual([]);
        const linked: ContextSource = { id: 'lead', kind: 'chat', title: 'Lexer' };
        expect(withForkOrigin('fork', [linked], readers({ lead: null, fork: null }))).toEqual([linked]);
    });
});
