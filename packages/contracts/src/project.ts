import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

export const ProjectIdSchema = z.string().min(1);
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const NodeKindSchema = z.enum(['terminal', 'chat', 'browser', 'group']);
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
    // Terminal only: Escape goes to the program in the shell instead of leaving node mode.
    escapeToApp: z.boolean().optional(),
    // Chat only: the agent session to continue.
    resume: z.string().optional(),
    // Chat only: which agent CLI answers; absent means Claude Code.
    provider: AgentKindSchema.optional(),
    // Browser only: the page it shows.
    url: z.string().optional(),
    // Group only: folded to its header, with the nodes it held out of sight until it opens again.
    collapsed: z.boolean().optional(),
    memberIds: z.array(z.string()).optional(),
    expandedHeight: z.number().positive().optional(),
    // Group only: the git worktree every node made inside it starts in.
    worktree: z.object({ path: z.string(), branch: z.string() }).optional()
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

// An edge from a text, terminal or chat into an agent's node: the agent may read the source.
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

// What the person edits; the daemon wraps it with the version and the rev.
export const ProjectContentSchema = z.object({
    name: z.string().min(1),
    color: z.string(),
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
    available: z.boolean()
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
