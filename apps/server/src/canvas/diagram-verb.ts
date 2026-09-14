import { DiagramEdgeSchema, DiagramGroupSchema, DiagramMetaSchema, DiagramNodeSchema, diagramProblemIn, isDiagramView } from '@ruimte/contracts';
import { DEFAULT_EDGE_TONE, DEFAULT_GROUP_TONE, DEFAULT_NODE_TONE } from '@ruimte/diagram';
import { z } from 'zod';
import { DiagramError } from '../projects/diagram-store.ts';
import { viewLines } from './view-verb.ts';
import { VerbRefusal, defineVerb, orNote, placeOf } from './verb.ts';

/*
 * The document as an agent hands it in. Strict at every level, unlike the schema a save reads: a
 * field an agent misspelled would otherwise be dropped without a word and the diagram written
 * without it. `version` and `rev` are the daemon's, and allowed only because a file read back from
 * disk carries them.
 */
const DocumentSchema = z.strictObject({
    version: z.unknown().optional(),
    rev: z.unknown().optional(),
    meta: z.strictObject(DiagramMetaSchema.shape),
    nodes: z.array(z.strictObject(DiagramNodeSchema.shape)),
    groups: z.array(z.strictObject(DiagramGroupSchema.shape)),
    edges: z.array(z.strictObject(DiagramEdgeSchema.shape))
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

/* What a field takes, read off its schema, so a shape or a tone added in contracts shows up here without an edit. */
const typeOf = (schema: z.ZodType): string => {
    if (schema instanceof z.ZodOptional) {
        return typeOf(schema.unwrap() as z.ZodType);
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

const fieldLines = (prefix: string, shape: Record<string, z.ZodType>, about: Record<string, string>): string[] =>
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
    'argument\t<viewId>\trequired\tA diagram view of this project; ruimte-context views lists them, ruimte-context view new <name> --kind diagram makes one',
    "stdin\tThe document as JSON, piped in or as a heredoc: ruimte-context diagram <viewId> <<'EOF' ... EOF",
    'flag\t--document JSON\toptional\tThe document as one argument instead of on stdin; the CLI puts stdin here when you leave it out',
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

const pathOf = (path: readonly PropertyKey[]): string =>
    path.reduce<string>((text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`), '');

const valueAt = (value: unknown, path: readonly PropertyKey[]): unknown =>
    path.reduce<unknown>(
        (current, key) => (current !== null && typeof current === 'object' ? (current as Record<PropertyKey, unknown>)[key] : undefined),
        value
    );

/* The item a path is inside, by what names it, so an agent finds the node without counting to index 17. */
const whoseLabel = (json: unknown, path: readonly PropertyKey[]): string => {
    const [list, index] = path;
    if (typeof index !== 'number') {
        return '';
    }
    const item = valueAt(json, [list!, index]) as Record<string, unknown> | undefined;
    if (list === 'edges' && typeof item?.from === 'string' && typeof item.to === 'string') {
        return ` (the edge from "${item.from}" to "${item.to}")`;
    }
    if (typeof item?.id === 'string') {
        return ` (${list === 'groups' ? 'group' : 'node'} "${item.id}")`;
    }
    return '';
};

/* Zod's own sentences ("Invalid input: expected string, received undefined") name the rule and not the repair. */
const issueText = (issue: z.core.$ZodIssue, json: unknown): string => {
    switch (issue.code) {
        case 'invalid_type':
            if (issue.path.length === 0) {
                return 'needs to be one JSON object with meta, nodes, groups and edges';
            }
            return `${valueAt(json, issue.path) === undefined ? 'is missing and needs' : 'needs'} ${/^[aeiou]/.test(issue.expected) ? 'an' : 'a'} ${issue.expected}`;
        case 'invalid_value':
            return `takes one of ${issue.values.map(String).join(', ')}`;
        case 'unrecognized_keys':
            return `has no field ${issue.keys.join(', ')}`;
        case 'too_small':
        case 'too_big':
            // Only an id and a pos have a length in the schema.
            return issue.origin === 'string' ? 'may not be empty' : 'needs two numbers, [x, y]';
        default:
            return issue.message;
    }
};

// Enough to repair a document in one pass, few enough that a broken one does not fill the window.
const MAX_PROBLEMS = 20;

const HELP_LINE = 'detail\truimte-context help diagram';

const documentProblems = (error: z.ZodError, json: unknown): VerbRefusal => {
    const problems = error.issues.map((issue) => {
        const path = pathOf(issue.path) || 'document';
        return { path, text: `${issueText(issue, json)}${whoseLabel(json, issue.path)}` };
    });
    const [first] = problems;
    return new VerbRefusal('bad-document', `${first!.path} ${first!.text}`, [
        ...problems.slice(0, MAX_PROBLEMS).map((problem) => `problem\t${problem.path}\t${problem.text}`),
        ...(problems.length > MAX_PROBLEMS ? [`note\t${problems.length - MAX_PROBLEMS} more past these`] : []),
        HELP_LINE
    ]);
};

export const diagramVerb = defineVerb({
    name: 'diagram',
    usage: '<viewId> < document.json',
    summary: 'Replaces the whole diagram of a diagram view with the JSON document on stdin; prints view, rev, nodes, groups, edges',
    detail: DETAIL,
    positionals: z.tuple([z.string().min(1, 'diagram needs the id of a diagram view')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'diagram takes one view id and nothing else; the document goes on stdin' : 'diagram needs the id of a diagram view'
    }),
    flags: z.object({ document: z.string().optional() }),
    async run({ positionals: [viewId], flags }, call) {
        const place = placeOf(call);
        const content = await call.host.read(place.projectId);
        const view = content.views.find((candidate) => candidate.id === viewId);
        if (!view || !isDiagramView(view)) {
            throw new VerbRefusal(
                'not-a-diagram',
                `${viewId} is not a diagram view of this project`,
                orNote(
                    viewLines(content.views.filter(isDiagramView)),
                    'This project has no diagram view; ruimte-context view new <name> --kind diagram makes one'
                )
            );
        }
        if (flags.document === undefined || flags.document.trim() === '') {
            throw new VerbRefusal('no-document', "diagram reads the document on stdin and got nothing: ruimte-context diagram <viewId> <<'EOF' ... EOF", [
                HELP_LINE
            ]);
        }
        let json: unknown;
        try {
            json = JSON.parse(flags.document);
        } catch (e) {
            throw new VerbRefusal('bad-json', `The document is not JSON: ${e instanceof Error ? e.message : 'it does not parse'}`, [HELP_LINE]);
        }
        const parsed = DocumentSchema.safeParse(json);
        if (!parsed.success) {
            throw documentProblems(parsed.error, json);
        }
        const { meta, nodes, groups, edges } = parsed.data;
        const problem = diagramProblemIn({ nodes, groups, edges });
        if (problem) {
            throw new VerbRefusal('diagram-invalid', problem, [HELP_LINE]);
        }
        let rev: number;
        try {
            rev = await call.host.writeDiagram(place.projectId, viewId, { meta, nodes, groups, edges });
        } catch (e) {
            if (e instanceof DiagramError) {
                throw new VerbRefusal(e.code, e.message);
            }
            throw e;
        }
        return [[viewId, rev, nodes.length, groups.length, edges.length].join('\t')];
    }
});
