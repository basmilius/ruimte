import { z } from 'zod';
import { PERSON_AND_VOICE, viewId, viewName, givenName, filePath } from './fields.ts';

export const LAYOUT_ACTIONS = {
    'layout.save': {
        title: 'Save canvas layout',
        description: 'Saves where the nodes and text of the active canvas are under a name. A saved layout with the same name is replaced, after confirmation.',
        effect: 'shared',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, name: givenName }),
        output: z.object({ viewId, view: viewName, name: viewName, replaced: z.boolean() })
    },
    'layout.apply': {
        title: 'Apply canvas layout',
        description: 'Moves the nodes and text of the active canvas to where a saved layout has them. Nothing is added or removed.',
        effect: 'shared',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, name: viewName }),
        output: z.object({ viewId, view: viewName, name: viewName })
    },
    'layout.delete': {
        title: 'Delete canvas layout',
        description: 'Deletes a saved layout of the active canvas, after confirmation. The nodes stay where they are.',
        effect: 'shared',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, name: viewName }),
        output: z.object({ viewId, view: viewName, name: viewName })
    },
    'split.create': {
        title: 'Split view',
        description: 'Opens a view in a new cell to the right of or below the focused one. Without a view it takes the first one that is not on screen yet.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ direction: z.enum(['right', 'down']), viewId: viewId.nullable() }),
        output: z.object({ viewId, view: z.string(), direction: z.enum(['right', 'down']) })
    },
    'split.close': {
        title: 'Close split cell',
        description: 'Closes the cell a view stands in, or the focused cell. Closing the last cell shows the empty view screen. The view stays in the project.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: viewId.nullable() }),
        output: z.object({ viewId, view: z.string() })
    },
    'split.focus': {
        title: 'Focus neighboring cell',
        description: 'Moves the focus to the cell left of, right of, above or below the focused one.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ direction: z.enum(['left', 'right', 'up', 'down']) }),
        output: z.object({ viewId, view: z.string(), changed: z.boolean() })
    },
    'split.placeView': {
        title: 'Place view in grid',
        description:
            'Puts a view or files at an edge to split a cell, or in its center to replace it. With tabGap, a center drop joins the tabs instead. A view already on screen moves there, and a view it replaces moves to where it came from.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({
            viewId: viewId.nullable().describe('A view of the project'),
            paths: z.array(filePath).min(1).nullable().describe('Files instead of a view; the first takes the place'),
            cellViewId: viewId.nullable().describe('The cell, by the view standing in it as workspace.inspect lists the cells; null for the focused cell'),
            zone: z.enum(['left', 'right', 'up', 'down', 'center']),
            tabGap: z
                .number()
                .int()
                .nonnegative()
                .nullable()
                .optional()
                .describe('For a center drop, join the tabs at this gap instead of replacing the cell; null inserts after the active tab')
        }),
        output: z.object({ viewId, view: z.string(), cellViewId: viewId, zone: z.string(), created: z.array(viewId) })
    }
} as const;
