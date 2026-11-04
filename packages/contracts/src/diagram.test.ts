import { describe, expect, test } from 'bun:test';
import { type DiagramDocument } from './diagram-host.ts';
import { REQUEST_SCHEMAS } from './index.ts';
import { ProjectDocumentSchema, isDiagramView, isOpenableView, isSessionView } from './project.ts';

const example: DiagramDocument = {
    version: 1,
    rev: 7,
    meta: { title: 'Ruimte op de draad', direction: 'right' },
    groups: [{ id: 'daemon', label: 'Daemon', wraps: ['sessions', 'projects'], tone: 'muted' }],
    nodes: [
        { id: 'client', label: 'Client', sub: 'React, Vite', tone: 'blue' },
        { id: 'sessions', label: 'SessionManager', sub: 'PTY per node' },
        { id: 'projects', label: 'ProjectStore', sub: '.ruimte/project.json', shape: 'cylinder' },
        { id: 'cli', label: 'Claude Code', shape: 'pill', tone: 'muted' }
    ],
    edges: [
        { from: 'client', to: 'sessions', label: 'session.attach', tone: 'accent' },
        { from: 'sessions', to: 'projects' },
        { from: 'cli', to: 'sessions', label: 'hooks', style: 'dashed' }
    ]
};

describe('a diagram view in a project document', () => {
    const document = {
        version: 3,
        rev: 1,
        name: 'ruimte',
        color: '#7c74ff',
        views: [
            { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
            { kind: 'diagram', id: 'view-abc', name: 'Diagram' }
        ]
    };

    test('it parses, carries nothing but its id and name, opens and has no session', () => {
        const view = ProjectDocumentSchema.parse(document).views[1]!;
        expect(view).toEqual({ kind: 'diagram', id: 'view-abc', name: 'Diagram' });
        expect(isDiagramView(view)).toBe(true);
        expect(isOpenableView(view)).toBe(true);
        expect(isSessionView(view)).toBe(false);
    });
});

describe('the wire', () => {
    test('a save names the rev it was built on', () => {
        const { version: _version, rev: _rev, ...content } = example;
        const payload = REQUEST_SCHEMAS['diagram.save'].payload.parse({ projectId: 'p1', viewId: 'view-abc', baseRev: 3, content });
        expect(payload).toMatchObject({ baseRev: 3 });
        expect(REQUEST_SCHEMAS['diagram.save'].payload.safeParse({ projectId: 'p1', viewId: 'view-abc', content }).success).toBe(false);
    });
});
