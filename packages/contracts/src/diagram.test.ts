import { describe, expect, test } from 'bun:test';
import { DiagramDocumentSchema, EMPTY_DIAGRAM, diagramProblemIn, migrateDiagram, type DiagramDocument } from './diagram.ts';
import { ProjectDocumentSchema, isDiagramView, isOpenableView, isSessionView } from './project.ts';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';

/* The example from the design report, word for word. */
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

describe('the diagram document', () => {
    test('the example from the report round-trips and breaks no rule', () => {
        const parsed = migrateDiagram(JSON.parse(JSON.stringify(example)));
        expect(parsed).toEqual(DiagramDocumentSchema.parse(example));
        expect(parsed).toEqual(example);
        expect(diagramProblemIn(parsed!)).toBeNull();
    });

    test('EMPTY_DIAGRAM parses as a document', () => {
        expect(migrateDiagram(EMPTY_DIAGRAM)).toEqual(EMPTY_DIAGRAM);
    });

    test('a node that was dragged keeps its position, and absent fields stay absent', () => {
        const parsed = migrateDiagram({ ...example, nodes: [{ id: 'a', label: 'A', pos: [12, 40] }] })!;
        expect(parsed.nodes[0]).toEqual({ id: 'a', label: 'A', pos: [12, 40] });
        expect(parsed.nodes[0]).not.toHaveProperty('shape');
    });

    test('a hex tone, an unknown shape, a stray direction, a version other than 1 and a missing rev are refused', () => {
        expect(migrateDiagram({ ...example, nodes: [{ id: 'a', label: 'A', tone: '#ff0000' }] })).toBeNull();
        expect(migrateDiagram({ ...example, nodes: [{ id: 'a', label: 'A', shape: 'star' }] })).toBeNull();
        expect(migrateDiagram({ ...example, meta: { title: '', direction: 'left' } })).toBeNull();
        expect(migrateDiagram({ ...example, version: 2 })).toBeNull();
        const { rev: _rev, ...withoutRev } = example;
        expect(migrateDiagram(withoutRev)).toBeNull();
    });

    test('an edge to an unknown id is refused with that id in the message', () => {
        const problem = diagramProblemIn({ ...example, edges: [...example.edges, { from: 'client', to: 'ghost' }] });
        expect(problem).toContain('"ghost"');
    });

    test('a group that wraps an unknown id is refused with that id in the message', () => {
        const problem = diagramProblemIn({ ...example, groups: [{ id: 'daemon', label: 'Daemon', wraps: ['sessions', 'nowhere'] }] });
        expect(problem).toContain('"nowhere"');
    });

    test('a repeated id, a group named like a node and a node in two groups are named', () => {
        expect(diagramProblemIn({ ...example, nodes: [...example.nodes, { id: 'cli', label: 'Again' }] })).toContain('"cli"');
        expect(diagramProblemIn({ ...example, groups: [{ id: 'client', label: 'Client', wraps: [] }] })).toContain('"client"');
        expect(
            diagramProblemIn({
                ...example,
                groups: [...example.groups, { id: 'other', label: 'Other', wraps: ['projects'] }]
            })
        ).toContain('"projects"');
    });
});

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
    test('every diagram request and event is in the tables', () => {
        expect(Object.keys(REQUEST_SCHEMAS)).toEqual(expect.arrayContaining(['diagram.open', 'diagram.save', 'diagram.close', 'diagram.copy']));
        expect(Object.keys(EVENT_SCHEMAS)).toContain('diagram.changed');
    });

    test('a save names the rev it was built on', () => {
        const { version: _version, rev: _rev, ...content } = example;
        const payload = REQUEST_SCHEMAS['diagram.save'].payload.parse({ projectId: 'p1', viewId: 'view-abc', baseRev: 3, content });
        expect(payload).toMatchObject({ baseRev: 3 });
        expect(REQUEST_SCHEMAS['diagram.save'].payload.safeParse({ projectId: 'p1', viewId: 'view-abc', content }).success).toBe(false);
    });
});
