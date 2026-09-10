import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';
import { RuntimeModeSchema } from './model.ts';

export const ProjectIdSchema = z.string().min(1);
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const NodeKindSchema = z.enum(['terminal', 'chat', 'browser', 'group', 'note']);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const ProjectNodeSchema = z.object({
    id: z.string().min(1),
    kind: NodeKindSchema,
    title: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    accent: z.string().optional(),
    // Terminal and chat: where the shell or the agent starts. Relative to the project folder on disk.
    cwd: z.string().optional(),
    // Terminal only: typed into the shell as its first line.
    command: z.string().optional(),
    // Terminal and chat: the agent session to continue.
    resume: z.string().optional(),
    // Terminal and chat: which agent CLI this node hosts; absent on a chat means Claude Code.
    provider: AgentKindSchema.optional(),
    // Chat only: the CLI was chosen when the node was made, so the composer offers no other one.
    providerFixed: z.boolean().optional(),
    // Terminal only: the permission mode its agent was started in, so a reload starts it the same way.
    runtimeMode: RuntimeModeSchema.optional(),
    // Browser only: the page it shows.
    url: z.string().optional(),
    // Group only: folded to its header, with the nodes it held out of sight until it opens again.
    collapsed: z.boolean().optional(),
    memberIds: z.array(z.string()).optional(),
    expandedHeight: z.number().positive().optional(),
    // Group only: the git worktree every node made inside it starts in.
    worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
    // Note only: its markdown and one of the note colors; without a color it takes the default.
    body: z.string().optional(),
    color: z.string().optional()
});
export type ProjectNode = z.infer<typeof ProjectNodeSchema>;

export const ProjectTextSchema = z.object({
    id: z.string().min(1),
    x: z.number(),
    y: z.number(),
    text: z.string(),
    size: z.number().positive()
});
export type ProjectText = z.infer<typeof ProjectTextSchema>;

// A line between two things on the canvas. Into an agent's node it also means the agent may read the source.
export const ProjectEdgeSchema = z.object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional()
});
export type ProjectEdge = z.infer<typeof ProjectEdgeSchema>;

// A named arrangement: where every node and text sat when it was saved.
export const ProjectLayoutSchema = z.object({
    name: z.string().min(1),
    nodes: z.record(z.string(), z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })),
    texts: z.record(z.string(), z.object({ x: z.number(), y: z.number() }))
});
export type ProjectLayout = z.infer<typeof ProjectLayoutSchema>;

// The Lucide icons a project may pick from. Closed on purpose: the client maps a name to a
// component, so a name it does not know would render nothing at all.
export const PROJECT_ICON_NAMES = [
    'box',
    'boxes',
    'package',
    'layers',
    'code',
    'terminal',
    'cpu',
    'database',
    'server',
    'cloud',
    'globe',
    'rocket',
    'zap',
    'flame',
    'sparkles',
    'star',
    'heart',
    'flag',
    'bookmark',
    'folder',
    'file-text',
    'book',
    'puzzle',
    'palette',
    'brush',
    'camera',
    'music',
    'video',
    'gamepad-2',
    'bot',
    'brain',
    'beaker',
    'wrench',
    'hammer',
    'shield',
    'key',
    'compass',
    'map',
    'leaf',
    'coffee'
] as const;

// An emoji is a few code points at most; the cap keeps a pasted paragraph out of the file.
export const PROJECT_ICON_EMOJI_MAX = 16;

// What a person picked, in the shared file next to the name. An image is never a blob here:
// it is a file at `.ruimte/icon.<ext>`, which the derived chain finds on its own.
export const ProjectIconChoiceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('emoji'), value: z.string().min(1).max(PROJECT_ICON_EMOJI_MAX) }),
    z.object({ kind: z.literal('lucide'), value: z.enum(PROJECT_ICON_NAMES) })
]);
export type ProjectIconChoice = z.infer<typeof ProjectIconChoiceSchema>;

/*
 * What the client renders: the choice, or what the daemon derived from the folder. An image
 * carries the path it was found at and a version that changes with the file, so the bytes come
 * from `GET /projects/<id>/icon?v=<version>` and the browser cache can hold them forever.
 */
export const ProjectIconSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('emoji'), value: z.string() }),
    z.object({ kind: z.literal('lucide'), value: z.enum(PROJECT_ICON_NAMES) }),
    z.object({ kind: z.literal('image'), value: z.string(), version: z.string() }),
    z.object({ kind: z.literal('initial'), value: z.string() })
]);
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;

// Where the name on screen came from: a person typed it, it is the folder's own name, or
// `.idea/.name` declared it.
export const ProjectNameSourceSchema = z.enum(['chosen', 'folder', 'idea']);
export type ProjectNameSource = z.infer<typeof ProjectNameSourceSchema>;

// What the person edits; the daemon wraps it with the version and the rev.
export const ProjectContentSchema = z.object({
    name: z.string().min(1),
    color: z.string(),
    // Absent means "show what the folder declares"; a file written before this existed parses fine.
    icon: ProjectIconChoiceSchema.optional(),
    // In stacking order, back to front.
    nodes: z.array(ProjectNodeSchema),
    texts: z.array(ProjectTextSchema),
    edges: z.array(ProjectEdgeSchema),
    layouts: z.array(ProjectLayoutSchema).default([])
});
export type ProjectContent = z.infer<typeof ProjectContentSchema>;

export const ProjectDocumentSchema = ProjectContentSchema.extend({
    version: z.literal(1),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative()
});
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

// Per machine, never in the shared file: where the camera was and what had focus.
export const ProjectLocalSchema = z.object({
    camera: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).nullable(),
    focusedNodeId: z.string().nullable()
});
export type ProjectLocal = z.infer<typeof ProjectLocalSchema>;

export const ProjectSummarySchema = z.object({
    projectId: ProjectIdSchema,
    name: z.string(),
    color: z.string(),
    // Null for a canvas that lives in the app data dir instead of a folder.
    folder: z.string().nullable(),
    lastOpenedAt: z.number(),
    // False when a folder project's file has gone missing since it was last seen.
    available: z.boolean(),
    // The choice from the file, or what the folder declares, or the initial on the project color.
    icon: ProjectIconSchema,
    nameSource: ProjectNameSourceSchema
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectListResultSchema = z.object({
    projects: z.array(ProjectSummarySchema)
});
export type ProjectListResult = z.infer<typeof ProjectListResultSchema>;

// Open by id, by folder (created there when the folder has no canvas yet), or a fresh one without a folder.
export const ProjectOpenPayloadSchema = z.object({
    projectId: ProjectIdSchema.optional(),
    folder: z.string().optional(),
    name: z.string().optional(),
    color: z.string().optional()
});
export type ProjectOpenPayload = z.infer<typeof ProjectOpenPayloadSchema>;

export const ProjectOpenResultSchema = z.object({
    summary: ProjectSummarySchema,
    document: ProjectDocumentSchema,
    local: ProjectLocalSchema
});
export type ProjectOpenResult = z.infer<typeof ProjectOpenResultSchema>;

export const ProjectSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    // The rev the client last loaded; the daemon refuses when the file moved on.
    baseRev: z.number().int().nonnegative(),
    content: ProjectContentSchema
});
export type ProjectSavePayload = z.infer<typeof ProjectSavePayloadSchema>;

export const ProjectSaveResultSchema = z.object({
    rev: z.number().int().nonnegative()
});
export type ProjectSaveResult = z.infer<typeof ProjectSaveResultSchema>;

export const ProjectSaveLocalPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    local: ProjectLocalSchema
});
export type ProjectSaveLocalPayload = z.infer<typeof ProjectSaveLocalPayloadSchema>;

export const ProjectTargetPayloadSchema = z.object({ projectId: ProjectIdSchema });
export type ProjectTargetPayload = z.infer<typeof ProjectTargetPayloadSchema>;

export const ProjectDeletePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    // Also remove the canvas file; a folder project's other files are never touched.
    removeFiles: z.boolean()
});
export type ProjectDeletePayload = z.infer<typeof ProjectDeletePayloadSchema>;

// The file changed under the daemon (a git pull, another machine); carries what is on disk now.
export const ProjectChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    document: ProjectDocumentSchema
});
export type ProjectChangedEvent = z.infer<typeof ProjectChangedEventSchema>;

// Writes or removes `.ruimte/icon.<ext>`; a null image deletes what is there. The bytes are
// base64 because a JSON frame carries no binary, and the daemon checks them against its own cap.
export const ProjectSetIconPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    image: z
        .object({
            mime: z.string().min(1),
            base64: z.string()
        })
        .nullable()
});
export type ProjectSetIconPayload = z.infer<typeof ProjectSetIconPayloadSchema>;

export const ProjectSummaryResultSchema = z.object({
    summary: ProjectSummarySchema
});
export type ProjectSummaryResult = z.infer<typeof ProjectSummaryResultSchema>;

// The name, color, icon or availability of a project changed; too small to ship a document for.
export const ProjectSummaryEventSchema = ProjectSummaryResultSchema;
export type ProjectSummaryEvent = z.infer<typeof ProjectSummaryEventSchema>;
