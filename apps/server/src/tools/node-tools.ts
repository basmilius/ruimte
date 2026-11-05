import { ToolRefusal } from '@adecore/agents/context';
import { NODE_ACCENT_NAMES, isCanvasView, isNodeAccent, type NodeAccent } from '@ruimte/contracts';
import { z } from 'zod';
import { COLOR_LINES } from '../actions/node-actions.ts';
import { field, placeOf, requiredField, titleField } from '../canvas/host.ts';
import { JSON_NODE_KINDS, NODE_NEW_KINDS, kindLine } from '../canvas/node-kinds.ts';
import { idList } from '../canvas/nodes.ts';
import { ARRANGE_LAYOUTS, type ArrangeLayout } from '../canvas/placement.ts';
import { canvasIdFor, defineActionTool, pointedCanvas, runAction } from './action-tool.ts';
import { ONE_WRITE, idsInput, jsonBatch, oneWrite } from './batch.ts';
import { defineTool, defineToolkit, PROJECT_INPUT, REVISION_INPUT, VIEW_INPUT } from './tool.ts';

const OFF_CANVAS = 'This session is not on a canvas; name one with view';

const OPENING_OFF_CANVAS =
    'A node opens on a canvas; name which one with view (view_list lists them). A line only joins two nodes of one canvas, so the edge column shows -';

const KIND_MESSAGE = `node_new needs a kind: ${NODE_NEW_KINDS.join(', ')}`;

/* The word that takes a node's color away. */
const NO_COLOR = 'none';

/* One node of a `json` call: the kind and the fields a single call takes. */
const JsonNodeSchema = z.strictObject({
    // An artifact or a routine node is left out: it names what it shows with fields of its own.
    kind: z.enum(JSON_NODE_KINDS, { error: `node_new needs a kind: ${JSON_NODE_KINDS.join(', ')}` }),
    title: titleField('title', 'title needs a title').optional(),
    text: z.string().optional(),
    url: z.string().min(1, 'url needs an http or https address').optional(),
    path: z.string().min(1, 'path needs the path of a file').optional(),
    source: z.string().min(1, 'source needs the id of a drawing or diagram view').optional(),
    device: z.string().min(1, 'device needs the id of a device of this machine').optional(),
    cwd: z.string().min(1, 'cwd needs the path of a directory').optional(),
    beside: z.string().min(1, 'beside needs the id of a node on that canvas').optional(),
    color: z.enum(NODE_ACCENT_NAMES, { error: `color takes one of the ${NODE_ACCENT_NAMES.length} colors` }).optional()
});

const NODES_EXAMPLE = '[{"kind":"note","title":"Idea","text":"Body","color":"teal"},{"kind":"browser","url":"https://example.com"}]';

/* One note of a `json` call: its id and the body. */
const JsonEditSchema = z.strictObject({
    id: z.string({ error: 'id needs the id of a note' }).min(1, 'id needs the id of a note'),
    text: z.string({ error: 'text needs the body to write' }),
    append: z.boolean({ error: 'append is true or false' }).optional()
});

const NOTES_EXAMPLE = '[{"id":"note-1","text":"Done"},{"id":"note-2","text":"One more line","append":true}]';

const SINGLE_NODE_FIELDS = ['kind', 'title', 'text', 'url', 'path', 'source', 'device', 'cwd', 'beside', 'color', 'artifact', 'version', 'routine'] as const;

/* The color a field names, null for `none` where taking a color off is allowed. */
function colorOf(color: string, none: boolean): NodeAccent | null {
    if (none && color === NO_COLOR) {
        return null;
    }

    if (isNodeAccent(color)) {
        return color;
    }

    throw new ToolRefusal('unknown-color', `${color} is not one of the ${NODE_ACCENT_NAMES.length} colors a node takes${none ? `, nor ${NO_COLOR}` : ''}`, [
        ...COLOR_LINES
    ]);
}

const nodeList = defineActionTool('node', {
    name: 'node_list',
    action: 'node.list',
    description: 'Lists the nodes of a canvas, where each stands and the group it is in.',
    annotations: { readOnly: true },
    input: z.object({ view: VIEW_INPUT, project: PROJECT_INPUT }),
    async run(input, call) {
        const listed = await runAction(call, 'node.list', { viewId: await canvasIdFor(call, placeOf(call), input.view, OFF_CANVAS) });

        return [
            ...listed.nodes.map((node) =>
                [
                    node.nodeId,
                    node.kind,
                    field(node.title),
                    ...[node.x, node.y, node.w, node.h].map((value) => String(Math.round(value))),
                    node.groupId ?? '',
                    node.flag ?? '-',
                    node.snoozedUntil ?? '-'
                ].join('\t')
            ),
            // Which row is the caller, which it can read nowhere else: a chat backend has no $RUIMTE_SESSION_ID.
            listed.self === null ? 'self\t-\tnone of these nodes is you' : `self\t${listed.self}`,
            `revision\t${listed.revision}`
        ];
    }
});

const nodeNew = defineActionTool('node', {
    name: 'node_new',
    action: 'node.create',
    description: 'Adds one node to a canvas, with a line from you into it.',
    input: z.object({
        kind: z.enum(NODE_NEW_KINDS, { error: KIND_MESSAGE }).optional(),
        title: titleField('title', 'title needs a title').optional(),
        text: z.string().optional().describe('For a note'),
        url: z.string().min(1, 'url needs an http or https address').optional().describe('For a browser'),
        path: z.string().min(1, 'path needs the path of a file').optional().describe('For a file'),
        source: z.string().min(1, 'source needs the id of a drawing or diagram view').optional().describe('For a drawing or diagram, a view of that kind'),
        device: z.string().min(1, 'device needs the id of a device of this machine').optional().describe('For a device'),
        cwd: z.string().min(1, 'cwd needs the path of a directory').optional().describe('For a terminal or chat'),
        artifact: z.string().min(1, 'artifact needs the id of an artifact').optional().describe('For an artifact'),
        version: z.string().min(1, 'version needs the id of a version').optional().describe('For an artifact, a version to stay on'),
        routine: z.string().min(1, 'routine needs the id of a routine').optional().describe('For a routine'),
        view: VIEW_INPUT,
        beside: z.string().min(1, 'beside needs the id of a node on that canvas').optional().describe('The node it goes right of'),
        color: z.string().min(1, 'color needs one of the colors').optional(),
        json: z.string().min(1, 'json needs an array of nodes').optional().describe('Several nodes at once. Format: guide topic nodes'),
        dry_run: z.boolean().optional()
    }),
    async run(input, call) {
        const dryRun = input.dry_run === true;

        if (input.json !== undefined) {
            const single = SINGLE_NODE_FIELDS.filter((key) => input[key] !== undefined);

            if (single.length > 0) {
                throw new ToolRefusal('bad-arguments', `json carries every node with its own fields; leave out ${single.join(', ')}`);
            }

            const nodes = jsonBatch(input.json, JsonNodeSchema, NODES_EXAMPLE, 'node');
            const made = await runAction(
                call,
                'node.createMany',
                {
                    viewId: await canvasIdFor(call, placeOf(call), input.view, OPENING_OFF_CANVAS),
                    nodes: nodes.map((node) => ({
                        kind: node.kind,
                        title: node.title ?? null,
                        content: node.text ?? null,
                        url: node.url ?? null,
                        path: node.path ?? null,
                        source: node.source ?? null,
                        cwd: node.cwd ?? null,
                        beside: node.beside ?? null,
                        device: node.device ?? null,
                        color: node.color ?? null
                    }))
                },
                dryRun
            );

            return made.nodes.map((node) =>
                dryRun
                    ? `dry-run\t${node.kind}\t${made.viewId}\t${node.edge ? `${node.edge.from} -> ${node.edge.to}` : '-'}`
                    : `${node.nodeId}\t${node.kind}\t${made.viewId}\t${node.edge?.edgeId ?? '-'}`
            );
        }

        if (input.kind === undefined) {
            throw new ToolRefusal('bad-arguments', KIND_MESSAGE);
        }

        const color = input.color === undefined ? null : colorOf(input.color, false);
        const viewId = await canvasIdFor(call, placeOf(call), input.view, OPENING_OFF_CANVAS);
        const made = await runAction(
            call,
            'node.create',
            {
                viewId,
                kind: input.kind,
                title: input.title ?? null,
                content: input.text ?? null,
                url: input.url ?? null,
                command: null,
                path: input.path ?? null,
                provider: null,
                at: null,
                source: input.source ?? null,
                device: input.device ?? null,
                cwd: input.cwd ?? null,
                beside: input.beside ?? null,
                color,
                artifact: input.artifact ?? null,
                artifactVersion: input.version ?? null,
                routine: input.routine ?? null
            },
            dryRun
        );
        const edge = made.edge ?? null;

        if (dryRun) {
            // The ends rather than the word "edge": the direction is the thing to check before anything is made.
            return [`dry-run\t${input.kind}\t${made.viewId}\t${edge ? `${edge.from} -> ${edge.to}` : '-'}`];
        }

        return [`${made.nodeId}\t${made.kind}\t${made.viewId}\t${edge?.edgeId ?? '-'}`];
    }
});

const nodeEdit = defineActionTool('node', {
    name: 'node_edit',
    action: 'node.update',
    description: 'Writes the body of a note you made or have a line with.',
    input: z.object({
        node_id: z.string().min(1, 'node_id needs the id of a note').optional(),
        text: z.string().optional(),
        json: z.string().min(1, 'json needs an array of notes').optional().describe('Several notes at once. Format: guide topic notes'),
        view: VIEW_INPUT,
        append: z.boolean().optional().describe('Adds under the body instead of replacing it')
    }),
    async run(input, call) {
        const append = input.append === true;

        if (input.json !== undefined) {
            const single = (['node_id', 'text', 'append'] as const).filter((key) => input[key] !== undefined);

            if (single.length > 0) {
                throw new ToolRefusal('bad-arguments', `json carries every note with its own fields; leave out ${single.join(', ')}`);
            }

            const edits = jsonBatch(input.json, JsonEditSchema, NOTES_EXAMPLE, 'note');
            const ids = edits.map((edit) => edit.id);
            const viewId = input.view ?? pointedCanvas(call, ids, 'note') ?? (await canvasIdFor(call, placeOf(call), undefined, OFF_CANVAS));
            const edited = await runAction(call, 'node.updateMany', {
                viewId,
                nodes: edits.map((edit) => ({ nodeId: edit.id, text: edit.text, append: edit.append ?? false }))
            });

            return edited.nodes.map((node) => `edited\t${node.nodeId}\t${node.lines}\t${node.characters}`);
        }

        if (input.node_id === undefined) {
            throw new ToolRefusal('bad-arguments', 'node_edit needs node_id, the id of a note, or json for several');
        }

        if (input.text === undefined) {
            throw new ToolRefusal('bad-arguments', 'node_edit needs text, the body to write');
        }

        const id = input.node_id;
        const viewId = input.view ?? pointedCanvas(call, [id], 'note') ?? (await canvasIdFor(call, placeOf(call), undefined, OFF_CANVAS));
        const edited = await runAction(call, 'node.update', { viewId, nodeId: id, text: input.text, append });

        return [`edited\t${id}\t${edited.lines}\t${edited.characters}`];
    }
});

/* A rename and a color land as one write, held to the revision, or as nothing when one of them is refused. */
const nodeUpdate = defineTool('node', {
    name: 'node_update',
    description: 'Renames a node or changes its color; give only what changes.',
    input: z.object({
        node_id: z.string({ error: 'node_update needs node_id, the id of a node' }).min(1, 'node_update needs node_id, the id of a node'),
        view: VIEW_INPUT,
        revision: REVISION_INPUT,
        title: titleField('title', 'title needs a title').optional(),
        color: z.string().min(1, `color needs one of the colors, or ${NO_COLOR}`).optional().describe('A color name, or none')
    }),
    async run(input, call) {
        if (input.title === undefined && input.color === undefined) {
            throw new ToolRefusal('nothing-to-change', 'node_update needs one of title, color');
        }

        const color = input.color === undefined ? undefined : colorOf(input.color, true);
        const id = input.node_id;
        return oneWrite(call, async (write) => {
            const lines: string[] = [];

            if (input.title !== undefined) {
                const viewId = await canvasIdFor(write, placeOf(write), input.view, OFF_CANVAS);
                const renamed = await runAction(write, 'node.rename', { viewId, nodeId: id, name: input.title });
                lines.push([id, renamed.kind, field(renamed.name)].join('\t'));
            }

            if (color !== undefined) {
                const viewId = input.view ?? pointedCanvas(write, [id]) ?? (await canvasIdFor(write, placeOf(write), undefined, OFF_CANVAS));
                const colored = await runAction(write, 'node.setColor', { viewId, nodeId: id, color });
                lines.push(['colored', id, colored.kind, colored.color ?? '-'].join('\t'));
            }

            return lines;
        });
    }
});

const nodeDelete = defineActionTool('node', {
    name: 'node_delete',
    action: 'node.delete',
    description: 'Removes nodes you made, with their sessions and lines.',
    annotations: { destructive: true },
    input: z.object({ node_id: idsInput('node_id', 'nodes to remove') }),
    async run(input, call) {
        const ids = input.node_id;
        const place = placeOf(call);
        const content = await call.host.projects.read(place.projectId);
        const canvases = content.views.filter(isCanvasView);
        const holders = ids.flatMap((id) => {
            const holding = canvases.find((view) => view.nodes.some((node) => node.id === id));

            return holding === undefined ? [] : [{ id, viewId: holding.id }];
        });
        const other = holders.find((holder) => holder.viewId !== holders[0]!.viewId);

        if (other !== undefined) {
            throw new ToolRefusal(
                'bad-arguments',
                `node_delete takes the nodes of one canvas per call, and ${holders[0]!.id} is on ${holders[0]!.viewId} while ${other.id} is on ${other.viewId}`
            );
        }

        // The action refuses a node on no canvas before it reads the canvas, so any id stands in for one there.
        const deleted = await runAction(call, 'node.delete', { viewId: holders[0]?.viewId ?? place.canvasId ?? ids[0]!, nodeIds: ids });
        const removed = deleted.removed ?? [];

        if (removed.length !== ids.length) {
            throw new Error(`node_delete removed ${removed.length} of ${ids.join(', ')}`);
        }

        return removed.flatMap((node) => [
            `deleted\t${node.nodeId}\t${node.kind}\t${field(node.title)}`,
            ...(node.ended ? [`ended\t${node.nodeId}\t${node.kind}`] : []),
            `edges\t${node.edges}`,
            ...(node.members === null ? [] : [`members\t${node.members}\tleft where they stand`])
        ]);
    }
});

const NODES_NEEDED = 'nodes needs one or more node ids, separated by commas';

const nodeGroup = defineActionTool('node', {
    name: 'node_group',
    action: 'group.create',
    description: 'Draws a group frame around nodes that stand together.',
    input: z.object({
        nodes: requiredField(NODES_NEEDED),
        label: titleField('label', 'label needs a name for the group').optional(),
        color: z.string().min(1, 'color needs a color').optional(),
        view: VIEW_INPUT
    }),
    async run(input, call) {
        const nodeIds = idList(input.nodes, 'nodes');
        const viewId = await canvasIdFor(call, placeOf(call), input.view, OFF_CANVAS);
        const grouped = await runAction(call, 'group.create', { viewId, nodeIds, label: input.label ?? null, color: input.color ?? null });

        return [
            [grouped.groupId, 'group', field(grouped.label ?? ''), grouped.viewId, String(grouped.members.length)].join('\t'),
            ...(grouped.also ?? []).map((node) => ['also', node.nodeId, node.kind, field(node.title)].join('\t')),
            ...(grouped.edges ? [['edges', String(grouped.edges.replaced), grouped.edges.edgeId].join('\t')] : [])
        ];
    }
});

const DEFAULT_LAYOUT: ArrangeLayout = 'grid';

const nodeArrange = defineActionTool('node', {
    name: 'node_arrange',
    action: 'node.arrange',
    description: 'Lays nodes out in a grid, a row or a column without overlap.',
    input: z.object({
        nodes: requiredField(NODES_NEEDED),
        layout: z.enum(ARRANGE_LAYOUTS, { error: `layout takes one of ${ARRANGE_LAYOUTS.join(', ')}` }).optional(),
        // A string, as agents have always sent it; a number of digits.
        cols: z
            .string()
            .regex(/^[1-9][0-9]*$/, 'cols needs a whole number of columns, 1 or more')
            .transform(Number)
            .optional(),
        view: VIEW_INPUT
    }),
    async run(input, call) {
        const nodeIds = idList(input.nodes, 'nodes');
        const viewId = await canvasIdFor(call, placeOf(call), input.view, OFF_CANVAS);
        const arranged = await runAction(call, 'node.arrange', { viewId, nodeIds, layout: input.layout ?? DEFAULT_LAYOUT, columns: input.cols ?? null });

        return arranged.nodes.map((node) => [node.nodeId, String(node.x), String(node.y)].join('\t'));
    }
});

const NODES_GUIDE = [
    `many\tTo add several nodes, give them all to one call in json instead of calling once per node: ${ONE_WRITE}`,
    'many\tEach node is checked the way a single call checks it, placed after the ones before it, and gets its own line from you; a refusal names the node by its place in the array, counted from 1',
    `example\t${NODES_EXAMPLE}`,
    ...NODE_NEW_KINDS.map(kindLine),
    'kind\tevery kind\ttitle, view, beside, color'
];

const NOTES_GUIDE = [
    `many\tTo write in several notes, give them all to one call in json instead of calling once per note: ${ONE_WRITE}`,
    'many\tEach note is checked the way a single call checks it and written in the order given, and a refusal names the note',
    `example\t${NOTES_EXAMPLE}`
];

export const nodeToolkit = defineToolkit(
    'node',
    [nodeList, nodeNew, nodeEdit, nodeUpdate, nodeDelete, nodeGroup, nodeArrange],
    [
        { name: 'nodes', lines: NODES_GUIDE },
        { name: 'notes', lines: NOTES_GUIDE }
    ]
);
