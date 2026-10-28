import { describe, expect, test } from 'bun:test';
import type { ContextSource, ProjectView } from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { withForkOrigin } from './fork-origin.ts';

// `later` stand on their canvas as later chats of a design node, so no node there carries their id.
function readers(places: Record<string, string | null>, forks: Record<string, string> = { fork: 'lead' }, later: readonly string[] = []) {
    const canvases = [...new Set(Object.values(places))].flatMap((canvasId): ProjectView[] =>
        canvasId === null
            ? []
            : [
                  {
                      kind: 'canvas',
                      id: canvasId,
                      name: canvasId,
                      nodes: Object.keys(places)
                          .filter((id) => places[id] === canvasId && !later.includes(id))
                          .map((id) => ({ id, kind: 'design', title: id, x: 0, y: 0, w: 100, h: 100 })),
                      texts: [],
                      edges: [],
                      layouts: []
                  }
              ]
    );
    return {
        forkedFrom: (id: string) => forks[id] ?? null,
        forksOf: (id: string) => Object.keys(forks).filter((fork) => forks[fork] === id),
        locate: (id: string): IndexedPlace | null => (id in places ? { projectId: 'p1', folder: '/work', canvasId: places[id]! } : null),
        titleFor: (id: string) => (id === 'lead' ? 'Lexer' : id === 'fork' ? 'Lexer (fork)' : null),
        viewsOf: () => canvases
    };
}

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

    test('a fork that is a later chat of a design node reads its original and is read by it, since no edge ends in it', () => {
        const places = { lead: 'main', fork: 'main' };
        expect(withForkOrigin('fork', [], readers(places, undefined, ['fork']))).toEqual([{ id: 'lead', kind: 'chat', title: 'Lexer' }]);
        expect(withForkOrigin('lead', [], readers(places, undefined, ['fork']))).toEqual([{ id: 'fork', kind: 'chat', title: 'Lexer (fork)' }]);
    });

    test('nothing is added for a chat that is no fork, an original that is gone, or one the edge already carries', () => {
        expect(withForkOrigin('fork', [], readers({ lead: null, fork: null }, {}))).toEqual([]);
        expect(withForkOrigin('fork', [], readers({ fork: null }))).toEqual([]);
        const linked: ContextSource = { id: 'lead', kind: 'chat', title: 'Lexer' };
        expect(withForkOrigin('fork', [linked], readers({ lead: null, fork: null }))).toEqual([linked]);
    });
});
