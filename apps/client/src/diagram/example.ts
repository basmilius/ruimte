import type { DiagramContent } from '@ruimte/contracts';

/*
 * A small diagram that shows what one can hold: shapes, a group, a label on a line and a dashed line
 * back. Written into the file like anything else, so a person can edit it into their own.
 */
export const exampleDiagram = (title: string): DiagramContent => ({
    meta: { title, direction: 'right' },
    nodes: [
        { id: 'idea', label: 'Idea', shape: 'pill' },
        { id: 'plan', label: 'Plan', sub: 'What to build' },
        { id: 'build', label: 'Build' },
        { id: 'review', label: 'Review', shape: 'diamond' },
        { id: 'ship', label: 'Ship', shape: 'round' }
    ],
    groups: [{ id: 'work', label: 'The work', wraps: ['plan', 'build'] }],
    edges: [
        { from: 'idea', to: 'plan' },
        { from: 'plan', to: 'build' },
        { from: 'build', to: 'review' },
        { from: 'review', to: 'ship', label: 'approved' },
        { from: 'review', to: 'build', label: 'changes', style: 'dashed' }
    ]
});
