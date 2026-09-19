import { z } from 'zod';
import { DrawingColorSchema, DrawingStrokeStyleSchema } from './drawing.ts';
import { ProjectIdSchema, ProjectSaveResultSchema } from './project.ts';

/*
 * A diagram is a directed graph with groups, written rather than drawn: the file says what is
 * connected to what and the layout is computed from that. Colors are the drawing palette's names,
 * so a diagram follows the theme the way a drawing does.
 */
export const DiagramShapeSchema = z.enum(['rect', 'round', 'pill', 'diamond', 'cylinder']);
export type DiagramShape = z.infer<typeof DiagramShapeSchema>;

export const DIAGRAM_SHAPES = DiagramShapeSchema.options;

export const DiagramDirectionSchema = z.enum(['right', 'down']);
export type DiagramDirection = z.infer<typeof DiagramDirectionSchema>;

export const DiagramEdgeStyleSchema = DrawingStrokeStyleSchema;
export type DiagramEdgeStyle = z.infer<typeof DiagramEdgeStyleSchema>;

export const DiagramNodeSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    sub: z.string().optional(),
    // Absent reads as 'rect'.
    shape: DiagramShapeSchema.optional(),
    tone: DrawingColorSchema.optional(),
    // Only on a node a person dragged; every other node goes where the layout puts it.
    pos: z.tuple([z.number(), z.number()]).optional()
});
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;

export const DiagramGroupSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    // Node ids, never group ids: a group is a box around nodes and does not nest.
    wraps: z.array(z.string().min(1)),
    tone: DrawingColorSchema.optional()
});
export type DiagramGroup = z.infer<typeof DiagramGroupSchema>;

export const DiagramEdgeSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
    // Absent reads as 'solid'.
    style: DiagramEdgeStyleSchema.optional(),
    tone: DrawingColorSchema.optional()
});
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;

export const DiagramMetaSchema = z.object({
    title: z.string(),
    direction: DiagramDirectionSchema
});
export type DiagramMeta = z.infer<typeof DiagramMetaSchema>;

export const DIAGRAM_VERSION = 1;

// What gets written; the daemon wraps it with the version and the rev, as it does for a drawing.
export const DiagramContentSchema = z.object({
    meta: DiagramMetaSchema,
    // In file order, which is also the order inside a layer of the layout.
    nodes: z.array(DiagramNodeSchema),
    groups: z.array(DiagramGroupSchema),
    edges: z.array(DiagramEdgeSchema)
});
export type DiagramContent = z.infer<typeof DiagramContentSchema>;

export const DiagramDocumentSchema = DiagramContentSchema.extend({
    version: z.literal(DIAGRAM_VERSION),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative()
});
export type DiagramDocument = z.infer<typeof DiagramDocumentSchema>;

export const EMPTY_DIAGRAM: DiagramDocument = { version: 1, rev: 0, meta: { title: '', direction: 'right' }, nodes: [], groups: [], edges: [] };

/* One version so far, so reading is a parse. A file that is not a diagram at all reads as null. */
export const migrateDiagram = (value: unknown): DiagramDocument | null => {
    const parsed = DiagramDocumentSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
};

/*
 * The first rule of the graph the content breaks, as a sentence that names the id, or null. The
 * schema cannot say this, and an agent that wrote the file needs the id to repair it: a silent drop
 * would leave it believing the edge is there.
 */
export const diagramProblemIn = (content: Pick<DiagramContent, 'nodes' | 'groups' | 'edges'>): string | null => {
    // Nodes and groups share one namespace, so an id always says which box it means.
    const nodes = new Set<string>();
    for (const node of content.nodes) {
        if (nodes.has(node.id)) {
            return `Two nodes share the id "${node.id}"`;
        }
        nodes.add(node.id);
    }
    const groups = new Set<string>();
    const groupOf = new Map<string, string>();
    for (const group of content.groups) {
        if (nodes.has(group.id) || groups.has(group.id)) {
            return `The group id "${group.id}" is already taken`;
        }
        groups.add(group.id);
        for (const id of group.wraps) {
            if (!nodes.has(id)) {
                return `The group "${group.id}" wraps "${id}", which is not a node`;
            }
            const other = groupOf.get(id);
            if (other !== undefined) {
                return `The node "${id}" is in two groups, "${other}" and "${group.id}"`;
            }
            groupOf.set(id, group.id);
        }
    }
    for (const edge of content.edges) {
        for (const end of [edge.from, edge.to]) {
            if (!nodes.has(end)) {
                return `The edge from "${edge.from}" to "${edge.to}" names "${end}", which is not a node`;
            }
        }
    }
    return null;
};

export const DiagramTargetPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1)
});
export type DiagramTargetPayload = z.infer<typeof DiagramTargetPayloadSchema>;

export const DiagramOpenResultSchema = z.object({
    document: DiagramDocumentSchema
});
export type DiagramOpenResult = z.infer<typeof DiagramOpenResultSchema>;

export const DiagramSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    // The rev the client last loaded; the daemon refuses when the file moved on.
    baseRev: z.number().int().nonnegative(),
    content: DiagramContentSchema
});
export type DiagramSavePayload = z.infer<typeof DiagramSavePayloadSchema>;

export const DiagramSaveResultSchema = ProjectSaveResultSchema;
export type DiagramSaveResult = z.infer<typeof DiagramSaveResultSchema>;

// Duplicating a view: the daemon copies the file under the new id at rev 0.
export const DiagramCopyPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    from: z.string().min(1),
    to: z.string().min(1)
});
export type DiagramCopyPayload = z.infer<typeof DiagramCopyPayloadSchema>;

// The file changed under the daemon (a hand edit, a git pull, an agent); carries what is on disk now.
export const DiagramChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    document: DiagramDocumentSchema
});
export type DiagramChangedEvent = z.infer<typeof DiagramChangedEventSchema>;
