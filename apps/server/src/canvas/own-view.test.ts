import { describe, expect, test } from 'bun:test';
import type { ProjectContent } from '@ruimte/contracts';
import { ownViewOf, refuseMissingNodes, refuseOwnView } from './own-view.ts';

/* The project of the session this came from: a canvas with a chat on it, and a second chat that
   stands in the sidebar as a view of its own. */
const content: Pick<ProjectContent, 'views'> = {
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'chat-on-main', kind: 'chat', title: 'Planner', x: 0, y: 0, w: 560, h: 360 }],
            texts: [],
            edges: [],
            layouts: []
        },
        { kind: 'chat', id: 'chat-of-its-own', name: 'Sidebar', node: {} },
        { kind: 'terminal', id: 'terminal-of-its-own', name: 'Shell', node: {} },
        { kind: 'drawing', id: 'sketch-1', name: 'Sketch' }
    ]
};

describe('ownViewOf', () => {
    test('finds a chat or a terminal the sidebar holds, and nothing else', () => {
        expect(ownViewOf(content, 'chat-of-its-own')?.kind).toBe('chat');
        expect(ownViewOf(content, 'terminal-of-its-own')?.kind).toBe('terminal');
        // A canvas, a drawing, a node and an id of nothing are all none of it.
        expect(ownViewOf(content, 'main')).toBeNull();
        expect(ownViewOf(content, 'sketch-1')).toBeNull();
        expect(ownViewOf(content, 'chat-on-main')).toBeNull();
        expect(ownViewOf(content, 'ghost')).toBeNull();
    });
});

describe('refuseOwnView', () => {
    test('says what the id is and closes the question of another canvas in the same sentence', () => {
        const refusal = refuseOwnView(ownViewOf(content, 'chat-of-its-own')!, 'no line can be drawn into it', ['node\tchat-on-main\tchat\tPlanner']);
        expect(refusal.code).toBe('not-on-a-canvas');
        expect(refusal.message).toBe(
            'chat-of-its-own is a chat that is a view of its own, not a node on any canvas of this project, so no line can be drawn into it'
        );
        expect(refusal.lines).toEqual(['node\tchat-on-main\tchat\tPlanner']);
    });
});

describe('refuseMissingNodes', () => {
    test('one id that is a view of its own is refused as one', () => {
        const refusal = refuseMissingNodes(content, ['terminal-of-its-own'], 'main', 'there is no node to rename');
        expect(refusal.code).toBe('not-on-a-canvas');
        expect(refusal.message).toBe(
            'terminal-of-its-own is a terminal that is a view of its own, not a node on any canvas of this project, so there is no node to rename'
        );
    });

    test('an id this project has nowhere keeps the sentence it has always had', () => {
        const refusal = refuseMissingNodes(content, ['ghost'], 'main', 'there is no node to rename', ['node\tchat-on-main\tchat\tPlanner']);
        expect(refusal.code).toBe('unknown-node');
        expect(refusal.message).toBe('ghost is not a node on main');
        expect(refusal.lines).toEqual(['node\tchat-on-main\tchat\tPlanner']);
    });

    test('several ids keep the sentence about the set, with the views among them named under it', () => {
        const refusal = refuseMissingNodes(content, ['chat-of-its-own', 'ghost'], 'main', 'there is no node to rename', ['node\tchat-on-main\tchat\tPlanner']);
        expect(refusal.code).toBe('unknown-node');
        expect(refusal.message).toBe('chat-of-its-own, ghost are not a node on main');
        expect(refusal.lines).toEqual([
            'note\tchat-of-its-own is a chat that is a view of its own, not a node on any canvas of this project',
            'node\tchat-on-main\tchat\tPlanner'
        ]);
    });
});
