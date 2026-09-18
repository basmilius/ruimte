import { describe, expect, test } from 'bun:test';
import type { ContextSource, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { refuseRead } from './read-refusal.ts';

const node = (id: string, kind: ProjectNode['kind'], extra: Partial<ProjectNode> = {}): ProjectNode => ({
    id,
    kind,
    title: id,
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    ...extra
});

/* The canvas of the session this all started in: a chat that opened two terminals, so both lines
   run from the chat into a terminal and neither runs back. */
const canvas: ProjectCanvasView = {
    id: 'main',
    name: 'Canvas',
    kind: 'canvas',
    nodes: [node('chat-1', 'chat'), node('terminal-a', 'terminal'), node('note-1', 'note'), node('draw-1', 'drawing', { viewId: 'view-1' })],
    texts: [{ id: 'text-1', x: 0, y: 0, text: 'Sprint', size: 16 }],
    edges: [{ id: 'edge-1', from: 'chat-1', to: 'terminal-a' }],
    layouts: []
};

describe('refuseRead', () => {
    test('a line that runs the other way says so, and names the call that draws it back', () => {
        const refusal = refuseRead('chat-1', 'terminal-a', [], canvas);
        const [first, second] = refusal.split('\n');
        expect(first).toStartWith('not-linked\tterminal-a is a terminal node on main with a line from you into it');
        expect(first).toInclude('reading it takes a line the other way');
        expect(second).toStartWith('see\truimte-context link new --from terminal-a --to chat-1\t');
    });

    test('a node on the canvas with no line at all is told which line it needs', () => {
        const refusal = refuseRead('chat-1', 'note-1', [], canvas);
        const [first, second] = refusal.split('\n');
        expect(first).toBe('not-linked\tnote-1 is a note node on main, but no line runs from it into you, and that line is what a read takes');
        expect(second).toStartWith('see\truimte-context link new --from note-1 --to chat-1\t');
    });

    test('a text is named as one, and a drawing is linked through the node that shows it', () => {
        expect(refuseRead('chat-1', 'text-1', [], canvas).split('\n')[0]).toStartWith('not-linked\ttext-1 is a text on main');
        expect(refuseRead('chat-1', 'view-1', [], canvas)).toInclude('see\truimte-context link new --from draw-1 --to chat-1\t');
    });

    test('an id of no canvas of this project keeps the sentence the CLI has always written', () => {
        expect(refuseRead('chat-1', 'nonsense', [], canvas)).toBe(
            'unknown-source\tnonsense is not linked to this session, and no node of main carries that id either'
        );
        // A session that is a view of its own has no canvas to say anything about.
        expect(refuseRead('chat-1', 'nonsense', [], null)).toBe('unknown-source\tnonsense is not linked to this session');
    });

    test('a source that is linked and still read nothing is not called unlinked', () => {
        const sources: ContextSource[] = [{ id: 'terminal-a', kind: 'terminal', title: 'dev server' }];
        expect(refuseRead('chat-1', 'terminal-a', sources, canvas)).toBe(
            'unreadable\tterminal-a is linked into you, but there is nothing to read in it right now'
        );
        // A drawing is linked under its node and read under its view id, and both are the same no.
        const drawing: ContextSource[] = [{ id: 'view-1', kind: 'drawing', title: 'Sketch', nodeId: 'draw-1' }];
        expect(refuseRead('chat-1', 'draw-1', drawing, canvas)).toStartWith('unreadable\t');
    });
});
