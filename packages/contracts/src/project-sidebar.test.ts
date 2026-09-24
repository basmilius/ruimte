import { expect, test } from 'bun:test';
import { projectSidebarViews, ProjectSidebarResultSchema } from './project-sidebar';
import type { ProjectView } from './project';

test('the sidebar projection keeps navigation and session identity but excludes canvas content', () => {
    const views: ProjectView[] = [
        {
            id: 'canvas',
            kind: 'canvas',
            name: 'Work',
            texts: [],
            edges: [],
            layouts: [],
            nodes: [
                {
                    id: 'agent',
                    title: 'Review',
                    kind: 'terminal',
                    provider: 'codex',
                    command: 'private command',
                    cwd: '/private/path',
                    x: 0,
                    y: 0,
                    w: 100,
                    h: 100
                },
                { id: 'note', title: 'Private note', kind: 'note', x: 0, y: 0, w: 100, h: 100 }
            ]
        },
        { id: 'chat', kind: 'chat', name: 'Discussion', node: { provider: 'claude' } }
    ];
    const projected = projectSidebarViews(views, ['canvas']);
    expect(projected[0]?.shared).toBe(true);
    expect(projected[0]?.nodes).toEqual([{ id: 'agent', title: 'Review', kind: 'terminal', provider: 'codex', titleSource: undefined }]);
    expect(projected[1]?.self).toMatchObject({ id: 'chat', title: 'Discussion', kind: 'chat', provider: 'claude' });
    expect(JSON.stringify(projected)).not.toContain('private');
    expect(projected.every((view) => !('texts' in view) && !('edges' in view))).toBe(true);
});

test('a row carries the flag of its view, and none for a color this version cannot paint', () => {
    const views: ProjectView[] = [
        { id: 'a', kind: 'canvas', name: 'A', nodes: [], texts: [], edges: [], layouts: [] },
        { id: 'b', kind: 'chat', name: 'B', node: {} }
    ];
    const projected = projectSidebarViews(views, [], { a: 'red', b: 'ultraviolet' });
    expect(projected[0]?.flag).toBe('red');
    expect('flag' in projected[1]!).toBe(false);
});

test('an empty sidebar result is valid for a machine with no open projects', () => {
    expect(ProjectSidebarResultSchema.safeParse({ projects: [] }).success).toBe(true);
});
