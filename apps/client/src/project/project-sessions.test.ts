import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode, ProjectView } from '@ruimte/contracts';
import { closeWarning, sessionNodesOf } from './project-sessions';

const node = (id: string, kind: ProjectNode['kind']): ProjectNode => ({ id, kind, x: 0, y: 0, w: 100, h: 100, title: id });

const canvas = (id: string, nodes: ProjectNode[]): ProjectCanvasView => ({ kind: 'canvas', id, name: id, nodes, texts: [], edges: [], layouts: [] });

describe('sessionNodesOf', () => {
    test('takes the terminals and the chats of every view, and nothing that only draws', () => {
        const views: ProjectView[] = [
            canvas('main', [node('t1', 'terminal'), node('n1', 'note'), node('c1', 'chat')]),
            canvas('second', [node('g1', 'group'), node('t2', 'terminal'), node('d1', 'drawing'), node('b1', 'browser')])
        ];
        expect(sessionNodesOf(views)).toEqual([
            { id: 't1', kind: 'terminal' },
            { id: 'c1', kind: 'chat' },
            { id: 't2', kind: 'terminal' }
        ]);
    });

    test('a view that is one session counts as the node it is, under the id of the view', () => {
        const views: ProjectView[] = [
            { kind: 'terminal', id: 'view-1', name: 'Shell', node: {} },
            { kind: 'chat', id: 'view-2', name: 'Claude', node: {} },
            { kind: 'browser', id: 'view-3', name: 'Docs', url: 'https://example.com' },
            { kind: 'drawing', id: 'view-4', name: 'Sketch' }
        ];
        expect(sessionNodesOf(views)).toEqual([
            { id: 'view-1', kind: 'terminal' },
            { id: 'view-2', kind: 'chat' }
        ]);
    });

    test('a project without anything running holds no sessions', () => {
        expect(sessionNodesOf([canvas('main', [node('n1', 'note')])])).toEqual([]);
    });
});

describe('closeWarning', () => {
    test('says what is lost, with the number of sessions in it', () => {
        expect(closeWarning(3)).toStartWith('Closing ends its 3 running sessions.');
        expect(closeWarning(1)).toStartWith('Closing ends its running session.');
    });

    test('a project with nothing running says so instead of counting zero', () => {
        expect(closeWarning(0)).toStartWith('Nothing in this project is running.');
        expect(closeWarning(0)).not.toInclude('session');
    });
});
