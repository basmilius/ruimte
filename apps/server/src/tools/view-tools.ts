import { ToolRefusal } from '@adecore/agents/context';
import { DEFAULT_EDGE_TONE, DEFAULT_GROUP_TONE, DEFAULT_NODE_TONE } from '@adecore/diagram';
import { DRAWING_EDIT_LIMITS, DrawingElementPatchSchema, NewDrawingElementSchema } from '@adecore/drawing';
import { DIAGRAM_LIMITS, DRAWING_COLORS, DiagramEdgeSchema, DiagramGroupSchema, DiagramMetaSchema, DiagramNodeSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { field, titleField } from '../canvas/host.ts';
import { VIEW_KINDS } from '../canvas/views.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { oneWrite } from './batch.ts';
import { fieldLines, typeOf } from './schema-lines.ts';
import { defineTool, defineToolkit, PROJECT_INPUT, REVISION_INPUT } from './tool.ts';

// A canvas with more nodes than this would bury the one line that says the view is gone.
const DELETED_NODE_LINES = 20;

/* The word that takes a mark away, the way the action's own `null` does. */
const NO_ICON = 'null';

function viewIdInput(tool: string) {
    const needs = `${tool} needs view_id, the id of a view; view_list lists them`;

    return z.string({ error: needs }).min(1, needs);
}

const viewList = defineActionTool('view', {
    name: 'view_list',
    action: 'view.list',
    description: 'Lists the views of the project in sidebar order.',
    annotations: { readOnly: true },
    input: z.object({ project: PROJECT_INPUT }),
    async run(_input, call) {
        const { views, self, revision } = await runAction(call, 'view.list', {});

        return [
            ...views.map((view) =>
                [
                    view.viewId,
                    view.kind,
                    field(view.name),
                    view.deletable ? 'yes' : 'no',
                    view.why,
                    view.icon === null ? '-' : field(view.icon),
                    view.flag ?? '-'
                ].join('\t')
            ),
            `self\t${self}`,
            `revision\t${revision}`
        ];
    }
});

const viewNew = defineActionTool('view', {
    name: 'view_new',
    action: 'view.create',
    description: 'Adds a view to the sidebar.',
    input: z.object({
        name: titleField('name', 'view_new needs a name'),
        kind: z.enum(VIEW_KINDS, { error: `kind takes one of ${VIEW_KINDS.join(', ')}` }).optional(),
        path: z.string().min(1, 'path needs the path of a file').optional().describe('For a file'),
        url: z.string().min(1, 'url needs an http or https address').optional().describe('For a browser'),
        connection: z.string().min(1, 'connection needs the id or the name of a database connection').optional().describe('For a database'),
        table: z.string().min(1, 'table needs the name of a table').optional().describe('For a database'),
        schema: z.string().min(1, 'schema needs the name of a schema').optional(),
        mode: z.enum(['data', 'structure'], { error: 'mode takes data or structure' }).optional(),
        where: z.string().min(1, 'where needs a filter, the text after WHERE').optional().describe('For a database, the SQL after WHERE'),
        after: z.string().min(1, 'after needs the id of a view').optional().describe('The view it goes under')
    }),
    async run(input, call) {
        const made = await runAction(call, 'view.create', {
            kind: input.kind ?? VIEW_KINDS[0]!,
            name: input.name,
            url: input.url ?? null,
            command: null,
            path: input.path ?? null,
            provider: null,
            after: input.after ?? null,
            connection: input.connection ?? null,
            schema: input.schema ?? null,
            table: input.table ?? null,
            mode: input.mode ?? null,
            where: input.where ?? null
        });

        return [`${made.viewId}\t${made.kind}\t${field(made.view)}`];
    }
});

/* A rename, a mark and a move land as one write, held to the revision, or as nothing when one of them is refused. */
const viewEdit = defineTool('view', {
    name: 'view_edit',
    description: 'Renames a view, sets its icon or moves it; give only what changes.',
    input: z.object({
        view_id: viewIdInput('view_edit'),
        revision: REVISION_INPUT,
        name: titleField('name', 'name needs a name').optional(),
        icon: z.string().min(1, `icon needs a Lucide name, or ${NO_ICON} to take the mark away`).optional().describe('A Lucide name, or null'),
        after: z.string().min(1, 'after needs the id of a view').optional().describe('The view it goes under'),
        first: z.boolean().optional()
    }),
    async run(input, call) {
        const id = input.view_id;
        const moves = input.after !== undefined || input.first === true;

        if (input.name === undefined && input.icon === undefined && !moves) {
            throw new ToolRefusal('nothing-to-change', 'view_edit needs one of name, icon, after, first');
        }

        if (input.after !== undefined && input.first === true) {
            throw new ToolRefusal('two-places', 'view_edit moves a view with one of after and first', [
                'field\tafter\tright under that view',
                'field\tfirst\tat the top of the list'
            ]);
        }

        return oneWrite(call, async (write) => {
            const lines: string[] = [];

            if (input.name !== undefined) {
                const renamed = await runAction(write, 'view.rename', { viewId: id, name: input.name });
                lines.push(`${id}\t${renamed.kind}\t${field(renamed.name)}`);
            }

            if (input.icon !== undefined) {
                const marked = await runAction(write, 'view.setIcon', { viewId: id, icon: input.icon === NO_ICON ? null : input.icon });
                lines.push(marked.icon === null ? `${id}\t${marked.kind}\t${NO_ICON}` : `${id}\t${marked.kind}\tlucide\t${field(marked.icon.value)}`);
            }

            if (moves) {
                const moved = await runAction(write, 'view.move', { viewId: id, afterViewId: input.after ?? null });
                lines.push(`${id}\t${moved.kind}\t${moved.index}`);
            }

            return lines;
        });
    }
});

const viewDelete = defineActionTool('view', {
    name: 'view_delete',
    action: 'view.delete',
    description: 'Removes a view you made, with the sessions it holds.',
    annotations: { destructive: true },
    input: z.object({ view_id: viewIdInput('view_delete') }),
    async run(input, call) {
        const id = input.view_id;
        const deleted = await runAction(call, 'view.delete', { viewId: id });
        const nodes = deleted.nodes ?? [];

        return [
            `deleted\t${id}\t${deleted.kind}\t${field(deleted.view)}`,
            ...(deleted.ended ?? []).map((node) => `ended\t${node.nodeId}\t${node.kind}`),
            // What a canvas took with it, counted and then named, so a caller knows whether the note it made is gone.
            ...(nodes.length === 0
                ? []
                : [`nodes\t${nodes.length}`, ...nodes.slice(0, DELETED_NODE_LINES).map((node) => `node\t${node.nodeId}\t${node.kind}\t${field(node.title)}`)])
        ];
    }
});

/*
 * The one tool that makes nothing. Looking at a view is one person at one screen, so this is an event
 * and each client decides for itself whether to follow it, which is also why it takes no `dry_run`.
 */
const viewOpen = defineActionTool('view', {
    name: 'view_open',
    action: 'view.focus',
    description: 'Shows a view to whoever has this project on screen.',
    input: z.object({ view_id: viewIdInput('view_open') }),
    async run(input, call) {
        const id = input.view_id;
        const shown = await runAction(call, 'view.focus', { viewId: id });

        return [
            `showing\t${id}\t${shown.kind}\t${field(shown.view)}`,
            shown.delivered === true
                ? 'sent\tyes\tEveryone with this project on screen was told'
                : 'sent\tno\tNobody has this project on screen right now, so nothing was showing it'
        ];
    }
});

const viewDiagram = defineActionTool('view', {
    name: 'view_diagram',
    action: 'diagram.replaceContent',
    description: 'Replaces the whole diagram of a diagram view with a JSON document.',
    input: z.object({
        view_id: viewIdInput('view_diagram'),
        document: z.string().optional().describe('Format: guide topic diagram')
    }),
    async run(input, call) {
        const written = await runAction(call, 'diagram.replaceContent', { viewId: input.view_id, document: input.document ?? '' });

        return [[written.viewId, written.rev, written.nodes, written.groups, written.edges].join('\t')];
    }
});

const viewDrawing = defineActionTool('view', {
    name: 'view_drawing',
    action: 'drawing.edit',
    description: 'Adds, changes and removes elements of a drawing view by id.',
    input: z.object({
        view_id: viewIdInput('view_drawing').describe('A drawing view, or a node that shows one'),
        // The drawing's own revision, as context_read prints it; a string, as agents have always sent it.
        revision: z.string().optional().describe('From context_read with form elements'),
        edit: z.string().optional().describe('Format: guide topic drawing'),
        dry_run: z.boolean().optional()
    }),
    async run(input, call) {
        const revision = input.revision === undefined || !/^\d+$/.test(input.revision) ? undefined : Number(input.revision);

        if (revision === undefined) {
            throw new ToolRefusal('bad-arguments', 'view_drawing needs revision, the whole number context_read with form elements printed');
        }

        const edited = await runAction(call, 'drawing.edit', { viewId: input.view_id, revision, edit: input.edit ?? '' }, input.dry_run === true);

        return [[edited.viewId, edited.rev, edited.elements].join('\t'), ...edited.added.map((id) => `added\t${id}`)];
    }
});

/* A sentence per field, keyed on the schema's own keys, so a field added to the file without one here fails to compile. */
const META_FIELDS: Record<keyof typeof DiagramMetaSchema.shape, string> = {
    title: 'What the diagram is called, drawn above it; may be empty',
    direction: 'Which way the edges run: right puts the layers side by side, down stacks them'
};

const NODE_FIELDS: Record<keyof typeof DiagramNodeSchema.shape, string> = {
    id: 'Unique among nodes and groups together; edges and groups name a node by it',
    label: 'The text in the box',
    sub: 'A smaller second line under the label',
    shape: 'The outline; rect when absent',
    tone: `A palette name, never a hex color, so the diagram follows the theme; ${DEFAULT_NODE_TONE} when absent`,
    pos: 'Only a person sets this, by dragging the node; leave it out and the layout places the node'
};

const GROUP_FIELDS: Record<keyof typeof DiagramGroupSchema.shape, string> = {
    id: 'Unique among nodes and groups together',
    label: 'The text over the box',
    wraps: 'The ids of the nodes inside it; a node is in at most one group, and a group never wraps a group',
    tone: `A palette name; ${DEFAULT_GROUP_TONE} when absent`
};

const EDGE_FIELDS: Record<keyof typeof DiagramEdgeSchema.shape, string> = {
    from: 'The id of the node the edge starts at; never a group',
    to: 'The id of the node the arrow points at; never a group',
    label: 'Text on the line',
    style: 'How the line is drawn; solid when absent',
    tone: `A palette name; ${DEFAULT_EDGE_TONE} when absent`
};

/* A document that passes, so an agent has one shape to start from; a test holds it to the schema. */
export const DIAGRAM_EXAMPLE = JSON.stringify({
    meta: { title: 'Checkout', direction: 'right' },
    nodes: [
        { id: 'web', label: 'Web shop', sub: 'React' },
        { id: 'api', label: 'API', shape: 'round' },
        { id: 'db', label: 'Orders', shape: 'cylinder', tone: 'blue' }
    ],
    groups: [{ id: 'backend', label: 'Backend', wraps: ['api', 'db'] }],
    edges: [
        { from: 'web', to: 'api', label: 'HTTPS' },
        { from: 'api', to: 'db', style: 'dashed' }
    ]
});

const DIAGRAM_GUIDE = [
    'document\t{ meta, nodes, groups, edges }\tone JSON object with all four keys, groups and edges [] when there are none; version and rev belong to the daemon and are ignored when present',
    ...fieldLines('meta.', DiagramMetaSchema.shape, META_FIELDS),
    ...fieldLines('nodes[].', DiagramNodeSchema.shape, NODE_FIELDS),
    ...fieldLines('groups[].', DiagramGroupSchema.shape, GROUP_FIELDS),
    ...fieldLines('edges[].', DiagramEdgeSchema.shape, EDGE_FIELDS),
    'layout\tThere are no coordinates to write: the layers come from the edges, and the order of nodes in the file is their order inside a layer',
    'replace\tA write replaces the whole diagram. A node written without pos loses a position a person dragged it to; copy pos from the file to keep one',
    'strict\tA field that is not listed here is refused by its path, never dropped',
    'rules\tIds never repeat across nodes and groups; an edge or a group naming an id that is not a node is refused with that id, and nothing is written',
    `limits\tAt most ${DIAGRAM_LIMITS.nodes} nodes and ${DIAGRAM_LIMITS.edges} edges; a larger diagram is refused, so split one that grows past that over more diagram views`,
    `example\t${DIAGRAM_EXAMPLE}`
];

/* An edit that passes, so an agent has one shape to start from; a test holds it to the schema. */
const DRAWING_EDIT_EXAMPLE = JSON.stringify({
    add: [
        { kind: 'ellipse', x: 620, y: 40, w: 90, h: 90, stroke: 'orange', strokeWidth: 2, fill: 'solid', fillColor: 'yellow' },
        {
            kind: 'line',
            x: 600,
            y: 85,
            w: 16,
            h: 0,
            points: [
                [0, 0],
                [16, 0]
            ],
            stroke: 'orange',
            strokeWidth: 2
        },
        { kind: 'text', x: 600, y: 150, w: 120, h: 30, text: 'Sun', size: 20 }
    ],
    update: [{ id: 'el-31', stroke: 'blue' }],
    remove: ['el-07']
});

/* Every kind with the fields it takes, read off the schema, so a field added in the package shows up here without an edit. */
function drawingKindLines(): string[] {
    return NewDrawingElementSchema.options.map((option) => {
        const shape = option.shape as Record<string, z.ZodType>;
        const fields = Object.entries(shape)
            .filter(([key]) => key !== 'kind')
            .map(([key, schema]) => `${key}${schema instanceof z.ZodOptional ? '?' : ''}: ${typeOf(schema)}`);

        return `kind\t${option.shape.kind.value}\t${fields.join(', ')}`;
    });
}

const DRAWING_GUIDE = [
    'edit\t{ add, update, remove }\tone JSON object; each list is optional, and the whole edit is one step: everything lands or nothing does',
    'add\tNew elements, drawn on top in the order given. The daemon gives each its id and seed; stroke is ink, strokeWidth 2 and a text or note size 20 when left out',
    ...drawingKindLines(),
    `update\t{ id, ...fields }\tthe fields that change on that element; its kind stays, and a field its kind does not have is refused: ${Object.keys(DrawingElementPatchSchema.shape).join(', ')}`,
    'remove\t[id]\tthe ids of the elements to take away',
    `colors\t${DRAWING_COLORS.join('|')}\tpalette names, never a hex color, so the drawing follows the theme`,
    'coordinates\tx and y are the top left corner of the box in drawing units, w and h its size; the points of a line or a freehand stroke are relative to x and y and lie inside the box. context_read with form elements prints every box',
    'revision\tThe revision context_read with form elements printed. A person may draw in the same drawing meanwhile: only an update or a remove of an element that changed after that revision is refused with rev-conflict, which names those elements; read again and decide anew',
    'undo\tA person takes back a whole call with one undo, so make a whole change in one call rather than one element at a time',
    'locked\tAn element a person locked is never updated or removed, and an edit cannot lock one',
    'strict\tA field that is not listed here is refused by its path, never dropped',
    `limits\tAt most ${DRAWING_EDIT_LIMITS.perEdit} elements added, updated and removed per call, and ${DRAWING_EDIT_LIMITS.elements} in the whole drawing after it`,
    `example\t${DRAWING_EDIT_EXAMPLE}`
];

export const viewToolkit = defineToolkit(
    'view',
    [viewList, viewNew, viewEdit, viewDelete, viewOpen, viewDiagram, viewDrawing],
    [
        { name: 'diagram', lines: DIAGRAM_GUIDE },
        { name: 'drawing', lines: DRAWING_GUIDE }
    ]
);
