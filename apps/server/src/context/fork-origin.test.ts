import { describe, expect, test } from 'bun:test';
import type { ContextSource } from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { withForkOrigin } from './fork-origin.ts';

const readers = (places: Record<string, string | null>, forks: Record<string, string> = { fork: 'lead' }) => ({
    forkedFrom: (id: string) => forks[id] ?? null,
    forksOf: (id: string) => Object.keys(forks).filter((fork) => forks[fork] === id),
    locate: (id: string): IndexedPlace | null => (id in places ? { projectId: 'p1', folder: '/work', canvasId: places[id]! } : null),
    titleFor: (id: string) => (id === 'lead' ? 'Lexer' : id === 'fork' ? 'Lexer (fork)' : null)
});

const text: ContextSource = { id: 'text-1', kind: 'text', title: 'Plan', text: 'plan' };

describe('withForkOrigin', () => {
    test('a fork that is a view reads its original, a view or a node alike', () => {
        const origin: ContextSource = { id: 'lead', kind: 'chat', title: 'Lexer' };
        expect(withForkOrigin('fork', [], readers({ lead: null, fork: null }))).toEqual([origin]);
        expect(withForkOrigin('fork', [text], readers({ lead: 'main', fork: null }))).toEqual([text, origin]);
    });

    test('an original reads its forks by the same rule, when no edge can join them', () => {
        const fork: ContextSource = { id: 'fork', kind: 'chat', title: 'Lexer (fork)' };
        expect(withForkOrigin('lead', [], readers({ lead: null, fork: null }))).toEqual([fork]);
        expect(withForkOrigin('lead', [text], readers({ lead: 'main', fork: null }))).toEqual([text, fork]);
        expect(withForkOrigin('lead', [], readers({ lead: 'main', fork: 'other' }))).toEqual([fork]);
        expect(withForkOrigin('lead', [], readers({ lead: 'main', fork: 'main' }))).toEqual([]);
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
