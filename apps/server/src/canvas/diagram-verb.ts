import { DiagramEdgeSchema, DiagramGroupSchema, DiagramMetaSchema, DiagramNodeSchema } from '@ruimte/contracts';
import { DEFAULT_EDGE_TONE, DEFAULT_GROUP_TONE, DEFAULT_NODE_TONE } from '@ruimte/diagram';
import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';

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

/* What a field takes, read off its schema, so a shape or a tone added in contracts shows up here without an edit. */
export const typeOf = (schema: z.ZodType): string => {
    if (schema instanceof z.ZodOptional) {
        return typeOf(schema.unwrap() as z.ZodType);
    }
    if (schema instanceof z.ZodLiteral) {
        return schema.values.size === 1 ? JSON.stringify([...schema.values][0]) : 'value';
    }
    if (schema instanceof z.ZodObject) {
        return 'object';
    }
    if (schema instanceof z.ZodEnum) {
        return schema.options.join('|');
    }
    if (schema instanceof z.ZodArray) {
        return `${typeOf(schema.element as z.ZodType)}[]`;
    }
    if (schema instanceof z.ZodTuple) {
        return `[${(schema.def.items as z.ZodType[]).map(typeOf).join(', ')}]`;
    }
    if (schema instanceof z.ZodString) {
        return 'string';
    }
    if (schema instanceof z.ZodNumber) {
        return 'number';
    }
    return 'value';
};

export const fieldLines = (prefix: string, shape: Record<string, z.ZodType>, about: Record<string, string>): string[] =>
    Object.entries(shape).map(
        ([key, schema]) => `field\t${prefix}${key}\t${schema instanceof z.ZodOptional ? 'optional' : 'required'}\t${typeOf(schema)}\t${about[key]}`
    );

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

const DETAIL: readonly string[] = [
    "stdin\tThe document as JSON, piped in or as a heredoc: ruimte-context view diagram <viewId> <<'EOF' ... EOF",
    'prints\tview\trev\tnodes\tgroups\tedges\tthe view written, its new rev, and how many nodes, groups and edges it now holds',
    'document\t{ meta, nodes, groups, edges }\tone JSON object; version and rev belong to the daemon and are ignored when present',
    ...fieldLines('meta.', DiagramMetaSchema.shape, META_FIELDS),
    ...fieldLines('nodes[].', DiagramNodeSchema.shape, NODE_FIELDS),
    ...fieldLines('groups[].', DiagramGroupSchema.shape, GROUP_FIELDS),
    ...fieldLines('edges[].', DiagramEdgeSchema.shape, EDGE_FIELDS),
    'layout\tThere are no coordinates to write: the layers come from the edges, and the order of nodes in the file is their order inside a layer',
    'replace\tA write replaces the whole diagram. A node written without pos loses a position a person dragged it to; copy pos from the file to keep one',
    'strict\tA field that is not listed here is refused by its path, never dropped',
    'rules\tIds never repeat across nodes and groups; an edge or a group naming an id that is not a node is refused with that id, and nothing is written',
    'edit\tA small change can also be an edit of .ruimte/diagrams/<viewId>.json with your own tools; the person sees it, but nothing checks it',
    `example\t${DIAGRAM_EXAMPLE}`
];

export const diagramAction = defineActionVerb('view', {
    name: 'diagram',
    action: 'diagram.replaceContent',
    usage: '<viewId> < document.json',
    params: [
        {
            syntax: '<viewId>',
            need: 'required',
            field: 'viewId',
            more: 'ruimte-context view list lists them, ruimte-context view new <name> --kind diagram makes one'
        },
        {
            syntax: '--document JSON',
            need: 'optional',
            field: 'document',
            text: 'The document as one argument instead of on stdin; the CLI puts stdin here when you leave it out'
        }
    ],
    detail: DETAIL,
    positionals: z.tuple([z.string().min(1, 'view diagram needs the id of a diagram view')], {
        error: (issue) =>
            issue.code === 'too_big'
                ? 'view diagram takes one view id and nothing else; the document goes on stdin'
                : 'view diagram needs the id of a diagram view'
    }),
    flags: z.object({ document: z.string().optional() }),
    async run({ positionals: [viewId], flags }, call) {
        const written = await runAction(call, 'diagram.replaceContent', { viewId, document: flags.document ?? '' });
        return [[written.viewId, written.rev, written.nodes, written.groups, written.edges].join('\t')];
    }
});
