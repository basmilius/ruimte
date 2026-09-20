import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';
import { GitDiffScopeSchema } from './git.ts';
import { RuntimeModeSchema } from './model.ts';
import { DeviceReferenceSchema } from './device.ts';
import { DrawingFontSchema } from './font.ts';

export const ProjectIdSchema = z.string().min(1);
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const NodeKindSchema = z.enum(['terminal', 'chat', 'browser', 'device', 'group', 'note', 'drawing', 'diagram', 'file']);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/*
 * Wrap entries from newer versions so they can be preserved verbatim. The reserved discriminant
 * keeps TypeScript narrowing useful for every known `kind`.
 */
export const UNKNOWN_KIND = 'unknown';

const KNOWN_NODE_KINDS: ReadonlySet<string> = new Set(NodeKindSchema.options);

// The frame a plate is drawn in when the entry does not say. Only used in memory, never written.
const UNKNOWN_NODE_SIZE = { w: 320, h: 200 };

const RawEntrySchema = z.record(z.string(), z.unknown());

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const positiveOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback);

/* The frame of a node of an unknown kind as the entry gives it, with what a plate needs where the entry is silent. */
const unknownNodeFrameOf = (raw: Record<string, unknown>): { id: unknown; title: string; x: number; y: number; w: number; h: number } => ({
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : String(raw.kind),
    x: finiteOr(raw.x, 0),
    y: finiteOr(raw.y, 0),
    w: positiveOr(raw.w, UNKNOWN_NODE_SIZE.w),
    h: positiveOr(raw.h, UNKNOWN_NODE_SIZE.h)
});

// What a person may change about such a node: where it stands, how big it is, and its id when a canvas is copied.
const UNKNOWN_NODE_WRITABLE = ['id', 'x', 'y', 'w', 'h'] as const;

/*
 * The shape an entry is read in. A kind this version knows stays as it is and is checked as usual;
 * one it does not know, with an id, becomes an `unknown` entry around what it read. An `unknown`
 * entry coming back over the wire is opened up first, so a machine that does know the kind reads the
 * real thing again.
 */
const readEntry = (
    value: unknown,
    known: ReadonlySet<string>,
    stored: (entry: Record<string, unknown>) => unknown,
    wrap: (raw: Record<string, unknown>) => unknown
): unknown => {
    if (!isRecord(value)) {
        return value;
    }
    const entry = value.kind === UNKNOWN_KIND && isRecord(value.raw) ? stored(value) : value;
    if (!isRecord(entry) || typeof entry.kind !== 'string' || entry.kind === '' || entry.kind === UNKNOWN_KIND || known.has(entry.kind)) {
        return entry;
    }
    if (typeof entry.id !== 'string' || entry.id === '') {
        return entry;
    }
    return wrap(entry);
};

// Where the title of a node came from: the session named itself from its first prompt, or a person
// typed it. The title follows the session until someone sets it.
export const NodeTitleSourceSchema = z.enum(['auto', 'user']);
export type NodeTitleSource = z.infer<typeof NodeTitleSourceSchema>;

export const ProjectNodeSchema = z.object({
    id: z.string().min(1),
    kind: z.union([NodeKindSchema, z.literal(UNKNOWN_KIND)]),
    title: z.string(),
    // Who named the node. Absent on a node nobody named yet, which is the only state in which its
    // session may still name it.
    titleSource: NodeTitleSourceSchema.optional(),
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
    // Device only: a portable identity resolved to a local simulator when it is shown.
    device: DeviceReferenceSchema.optional(),
    // Group only: folded to its header, with the nodes it held out of sight until it opens again.
    collapsed: z.boolean().optional(),
    memberIds: z.array(z.string()).optional(),
    expandedHeight: z.number().positive().optional(),
    // Group only: the git worktree every node made inside it starts in.
    worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
    // Note only: its markdown and one of the note colors; without a color it takes the default.
    body: z.string().optional(),
    color: z.string().optional(),
    // Drawing and diagram only: the view of that kind this node mirrors, which lives in the same project.
    viewId: z.string().optional(),
    /* File only: the file it reads. Relative to the project folder, POSIX, so the node still points
       at the same file in another checkout; a file outside that folder keeps its absolute path. */
    path: z.string().optional(),
    // Unknown kind only: the entry exactly as it was read.
    raw: RawEntrySchema.optional()
});
export type ProjectNode = z.infer<typeof ProjectNodeSchema>;

/* Every kind a node on a canvas can have in memory: the ones this version makes, and the one it only carries. */
export type CanvasNodeKind = ProjectNode['kind'];

export const isUnknownNode = (node: Pick<ProjectNode, 'kind'>): boolean => node.kind === UNKNOWN_KIND;

/* A node the way the file holds it: an unknown one is what was read, with whatever a person moved on top. */
export const storedNodeOf = (node: ProjectNode): unknown => {
    if (node.kind !== UNKNOWN_KIND || !node.raw) {
        return node;
    }
    const read = unknownNodeFrameOf(node.raw);
    const stored: Record<string, unknown> = { ...node.raw };
    for (const key of UNKNOWN_NODE_WRITABLE) {
        if (node[key] !== read[key]) {
            stored[key] = node[key];
        }
    }
    return stored;
};

export const CanvasNodeSchema = z.preprocess(
    (value) =>
        readEntry(
            value,
            KNOWN_NODE_KINDS,
            (entry) => storedNodeOf(entry as ProjectNode),
            (raw) => ({ ...unknownNodeFrameOf(raw), kind: UNKNOWN_KIND, raw })
        ),
    ProjectNodeSchema
);

/* A label standing free on a canvas. Style is the whole element's; there is no run inside the text. */
export const ProjectTextSchema = z.object({
    id: z.string().min(1),
    x: z.number(),
    y: z.number(),
    text: z.string(),
    size: z.number().positive(),
    // Absent means 'sans', the face the app itself is set in.
    font: DrawingFontSchema.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional()
});
export type ProjectText = z.infer<typeof ProjectTextSchema>;

// A line between two things on the canvas. Into an agent's node it also means the agent may read the source.
/* The side of a node a line leaves from or lands on. */
export const NodeSideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export type NodeSide = z.infer<typeof NodeSideSchema>;

/*
 * Loose, so a field a newer Ruimte put on an edge is read, carried and written back untouched, the
 * way an entry of an unknown kind is. An edge is flat and has no `kind` to hang a wrapper on, so
 * keeping the extra keys where they already sit is all it takes; nothing here may rebuild an edge
 * out of the fields this version knows.
 */
export const ProjectEdgeSchema = z.looseObject({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
    /* The port a person drew this line from, which it keeps whatever the two nodes do afterwards.
       An end without one is free: the canvas puts it on the side that reads best. */
    fromSide: NodeSideSchema.optional(),
    toSide: NodeSideSchema.optional(),
    /* What the line means; see `EDGE_ROLES`. A plain string and not an enum, or a word a newer
       Ruimte wrote would fail the parse and take the whole edge with it. Read it with `edgeRole`. */
    role: z.string().optional()
});
export type ProjectEdge = z.infer<typeof ProjectEdgeSchema>;

/*
 * What a line is for. `context` is the one every version has drawn: the agent it touches reads the
 * other end with `ruimte-context read` and may notify along it, and between two agents the head is
 * the one that reads. `target` runs from an agent into something it can drive. `origin` is drawn by the daemon when one node opened another and carries no permission of
 * its own, only where the node came from.
 */
export const EDGE_ROLES = ['context', 'target', 'origin'] as const;
export const EdgeRoleSchema = z.enum(EDGE_ROLES);
export type EdgeRole = z.infer<typeof EdgeRoleSchema>;

const KNOWN_EDGE_ROLES: ReadonlySet<string> = new Set(EDGE_ROLES);

/*
 * The role of a line as this version understands it. A role it does not know reads as none, so the
 * line falls back to what a line without a role has always been, while the word itself stays on the
 * edge for the Ruimte that wrote it. Same rule as a node or a view of an unknown kind.
 */
export const edgeRole = (edge: Pick<ProjectEdge, 'role'>): EdgeRole | null =>
    edge.role !== undefined && KNOWN_EDGE_ROLES.has(edge.role) ? (edge.role as EdgeRole) : null;

// A named arrangement: where every node and text sat when it was saved.
export const ProjectLayoutSchema = z.object({
    name: z.string().min(1),
    nodes: z.record(z.string(), z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })),
    texts: z.record(z.string(), z.object({ x: z.number(), y: z.number() }))
});
export type ProjectLayout = z.infer<typeof ProjectLayoutSchema>;

// Persisted icon names form a closed, append-only set because unknown or renamed names render nothing.
export const PROJECT_ICON_NAMES = [
    'box',
    'boxes',
    'package',
    'layers',
    'code',
    'terminal',
    'cpu',
    'circuit-board',
    'memory-stick',
    'pc-case',
    'laptop',
    'monitor',
    'smartphone',
    'tablet',
    'webcam',
    'printer',
    'hard-drive',
    'usb',
    'database',
    'server',
    'container',
    'network',
    'router',
    'ethernet-port',
    'cable',
    'plug',
    'wifi',
    'radio-tower',
    'satellite-dish',
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

// What a person picked, in the shared file next to the name. One of the Lucide names and nothing
// else: a mark is drawn beside a name at 14 pixels, where the app's own line weight is what makes a
// row of them read as a list. An image is never a blob here: it is a file at `.ruimte/icon.<ext>`,
// which the derived chain finds on its own.
export const ProjectIconChoiceSchema = z.object({ kind: z.literal('lucide'), value: z.enum(PROJECT_ICON_NAMES) });
export type ProjectIconChoice = z.infer<typeof ProjectIconChoiceSchema>;

/*
 * What the client renders: the choice, or what the daemon derived from the folder. An image
 * carries the path it was found at and a version that changes with the file, so the bytes come
 * from `GET /projects/<id>/icon?v=<version>` and the browser cache can hold them forever.
 */
export const ProjectIconSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lucide'), value: z.enum(PROJECT_ICON_NAMES) }),
    z.object({ kind: z.literal('image'), value: z.string(), version: z.string() }),
    z.object({ kind: z.literal('initial'), value: z.string() })
]);
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;

// Where the name on screen came from: a person typed it, or it is the folder's own name.
export const ProjectNameSourceSchema = z.enum(['chosen', 'folder']);
export type ProjectNameSource = z.infer<typeof ProjectNameSourceSchema>;

// The one canvas a version-1 file held becomes this view, on every machine that migrates it.
export const MAIN_VIEW_ID = 'main';
export const MAIN_VIEW_NAME = 'Canvas';

/*
 * The node that made this view with a canvas verb; absent on one a person made. It is in the shared
 * file on purpose, unlike the depth of a node, which is daemon state: a maker is a fact both sides
 * read (`ruimte-context view delete` only removes a view whose maker is the caller, and the sidebar
 * can say who made a row), and nothing has to be defended with it, since a person deleting a view
 * of their own is not something the rule is about.
 */
const CreatedBySchema = z.string().min(1).optional();

const ViewBaseSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    // Who named the view, the rule a node follows: absent or 'auto' means the page it hosts may
    // still name it, 'user' means a person did and nothing renames it again.
    titleSource: NodeTitleSourceSchema.optional(),
    // Absent means the row wears the mark of what it is: its kind, its CLI, or a page's favicon.
    // Present means a person overruled that, so nothing the view hosts changes it again.
    icon: ProjectIconChoiceSchema.optional(),
    createdBy: CreatedBySchema
});

/*
 * A standalone view hosts one node without a place on a canvas, so it carries what a node carries
 * minus its frame. Its id is the session id, the same rule a node follows, which is why moving a
 * node between a canvas and a view of its own never restarts anything.
 */
export const StandaloneNodeSchema = ProjectNodeSchema.pick({
    cwd: true,
    command: true,
    resume: true,
    provider: true,
    providerFixed: true,
    runtimeMode: true,
    accent: true
});
export type StandaloneNode = z.infer<typeof StandaloneNodeSchema>;

export const ProjectCanvasViewSchema = ViewBaseSchema.extend({
    kind: z.literal('canvas'),
    // In stacking order, back to front.
    nodes: z.array(CanvasNodeSchema),
    texts: z.array(ProjectTextSchema),
    edges: z.array(ProjectEdgeSchema),
    layouts: z.array(ProjectLayoutSchema).default([])
});
export type ProjectCanvasView = z.infer<typeof ProjectCanvasViewSchema>;

/*
 * A line between rows in the sidebar. It rides in the view list because the order of the file is the
 * order of the list, but it holds nothing, never opens and takes no node: only the rows around it
 * read differently for it being there. Its label is optional, since a bare line groups just as well.
 */
export const ProjectSeparatorViewSchema = z.object({
    kind: z.literal('separator'),
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    createdBy: CreatedBySchema
});
export type ProjectSeparatorView = z.infer<typeof ProjectSeparatorViewSchema>;

/*
 * A heading over the rows under it. Like a separator it is a row that divides the list rather than
 * a place to go, but its whole point is what it says, so the name is required where a separator's
 * is optional. It wears no mark: the text lines up with the marks of the rows it heads.
 */
export const ProjectSubheaderViewSchema = z.object({
    kind: z.literal('subheader'),
    id: z.string().min(1),
    name: z.string().min(1),
    createdBy: CreatedBySchema
});
export type ProjectSubheaderView = z.infer<typeof ProjectSubheaderViewSchema>;

export const ProjectChatViewSchema = ViewBaseSchema.extend({ kind: z.literal('chat'), node: StandaloneNodeSchema });
export type ProjectChatView = z.infer<typeof ProjectChatViewSchema>;

export const ProjectTerminalViewSchema = ViewBaseSchema.extend({ kind: z.literal('terminal'), node: StandaloneNodeSchema });
export type ProjectTerminalView = z.infer<typeof ProjectTerminalViewSchema>;

export const ProjectBrowserViewSchema = ViewBaseSchema.extend({ kind: z.literal('browser'), url: z.string() });
export type ProjectBrowserView = z.infer<typeof ProjectBrowserViewSchema>;

export const ProjectDeviceViewSchema = ViewBaseSchema.extend({ kind: z.literal('device'), device: DeviceReferenceSchema });
export type ProjectDeviceView = z.infer<typeof ProjectDeviceViewSchema>;

/* A sketch of its own. The elements live in `.ruimte/drawings/<id>.json`, never in this file. */
export const ProjectDrawingViewSchema = ViewBaseSchema.extend({ kind: z.literal('drawing') });
export type ProjectDrawingView = z.infer<typeof ProjectDrawingViewSchema>;

/* A graph that is written rather than drawn. The graph lives in `.ruimte/diagrams/<id>.json`, never in this file. */
export const ProjectDiagramViewSchema = ViewBaseSchema.extend({ kind: z.literal('diagram') });
export type ProjectDiagramView = z.infer<typeof ProjectDiagramViewSchema>;

/* An automation, drawn as a graph. The cards live in `.ruimte/flows/<id>.json`, never in this file,
   and whether it runs here is not in either: that is one person's word on one machine. */
export const ProjectFlowViewSchema = ViewBaseSchema.extend({ kind: z.literal('flow') });
export type ProjectFlowView = z.infer<typeof ProjectFlowViewSchema>;

/* One file on disk, read and never written. The path is the whole view: the bytes are the
   file system's, so there is nothing here for Ruimte to own, migrate or save. */
export const ProjectFileViewSchema = ViewBaseSchema.extend({ kind: z.literal('file'), path: z.string().min(1) });
export type ProjectFileView = z.infer<typeof ProjectFileViewSchema>;

const KNOWN_VIEW_SCHEMAS = [
    ProjectCanvasViewSchema,
    ProjectChatViewSchema,
    ProjectTerminalViewSchema,
    ProjectBrowserViewSchema,
    ProjectDeviceViewSchema,
    ProjectDrawingViewSchema,
    ProjectDiagramViewSchema,
    ProjectFlowViewSchema,
    ProjectFileViewSchema,
    ProjectSeparatorViewSchema,
    ProjectSubheaderViewSchema
] as const;

/* The kinds this version can make and open, in the order of the union. */
export const PROJECT_VIEW_KINDS = KNOWN_VIEW_SCHEMAS.map((schema) => schema.shape.kind.value);

const KNOWN_VIEW_KINDS: ReadonlySet<string> = new Set(PROJECT_VIEW_KINDS);

/*
 * A view of a kind a newer Ruimte made: listed under its name, never opened, and written back as it
 * was read. The name falls back to the kind, since a sidebar row needs something to say.
 */
export const ProjectUnknownViewSchema = z.object({
    kind: z.literal(UNKNOWN_KIND),
    id: z.string().min(1),
    name: z.string().min(1),
    // Read from the entry, so `view delete` still knows who made it; never written from here.
    createdBy: CreatedBySchema,
    raw: RawEntrySchema
});
export type ProjectUnknownView = z.infer<typeof ProjectUnknownViewSchema>;

export const ProjectViewSchema = z.preprocess(
    (value) =>
        readEntry(
            value,
            KNOWN_VIEW_KINDS,
            (entry) => entry.raw,
            (raw) => ({
                kind: UNKNOWN_KIND,
                id: raw.id,
                name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.kind,
                ...(typeof raw.createdBy === 'string' && raw.createdBy !== '' ? { createdBy: raw.createdBy } : {}),
                raw
            })
        ),
    z.discriminatedUnion('kind', [...KNOWN_VIEW_SCHEMAS, ProjectUnknownViewSchema])
);
export type ProjectView = z.infer<typeof ProjectViewSchema>;
export type ProjectViewKind = ProjectView['kind'];

export const isCanvasView = (view: ProjectView): view is ProjectCanvasView => view.kind === 'canvas';

export const isSeparatorView = (view: ProjectView): view is ProjectSeparatorView => view.kind === 'separator';

export const isSubheaderView = (view: ProjectView): view is ProjectSubheaderView => view.kind === 'subheader';

/* The rows that divide the list rather than stand in it: a line, and a heading over what follows.
   Neither opens, neither holds a session, and neither is shared on its own. */
export const isDividerView = (view: ProjectView): view is ProjectSeparatorView | ProjectSubheaderView => isSeparatorView(view) || isSubheaderView(view);

export const isDrawingView = (view: ProjectView): view is ProjectDrawingView => view.kind === 'drawing';

export const isDiagramView = (view: ProjectView): view is ProjectDiagramView => view.kind === 'diagram';

export const isFlowView = (view: ProjectView): view is ProjectFlowView => view.kind === 'flow';

export const isFileView = (view: ProjectView): view is ProjectFileView => view.kind === 'file';

export const isUnknownView = (view: ProjectView): view is ProjectUnknownView => view.kind === UNKNOWN_KIND;

/* The mark a person picked for a view; a divider has no room for one and an unknown view keeps whatever it has in the file. */
export const viewIconOf = (view: ProjectView): ProjectIconChoice | null => (isDividerView(view) || view.kind === UNKNOWN_KIND ? null : (view.icon ?? null));

/*
 * The views that are one session under their own id: what a node carries, without a canvas around
 * it. A divider holds nothing, and a drawing, a diagram and a file are all read off disk, so none
 * of them has a session to attach to.
 */
export const isSessionView = (view: ProjectView): view is ProjectChatView | ProjectTerminalView | ProjectBrowserView | ProjectDeviceView =>
    view.kind === 'chat' || view.kind === 'terminal' || view.kind === 'browser' || view.kind === 'device';

/* The views a person can put on screen. A divider marks the list rather than standing in it, and
   this version has nothing to draw a view of an unknown kind with. */
export const isOpenableView = (view: ProjectView): boolean => !isDividerView(view) && view.kind !== UNKNOWN_KIND;

/* A view the way the file holds it. */
export const storedViewOf = (view: ProjectView): unknown => {
    if (view.kind === UNKNOWN_KIND) {
        return view.raw;
    }
    return view.kind === 'canvas' ? { ...view, nodes: view.nodes.map(storedNodeOf) } : view;
};

// What the person edits; the daemon wraps it with the version and the rev.
export const ProjectContentSchema = z.object({
    name: z.string().min(1),
    color: z.string(),
    // Absent means "show what the folder declares"; a file written before this existed parses fine.
    icon: ProjectIconChoiceSchema.optional(),
    // In sidebar order. Never empty: deleting the last view leaves an empty canvas behind.
    views: z.array(ProjectViewSchema).min(1)
});
export type ProjectContent = z.infer<typeof ProjectContentSchema>;

/*
 * The views that live in the shared file, which is the one a team commits. Derived by the daemon
 * from which of the two files a view was read out of and never stored as a list of its own, so
 * there is nothing here that can fall out of step with the folder. Absent means nothing is shared,
 * which is every project until a person says otherwise.
 *
 * It rides beside the content and not in it on purpose: a verb hands back content, so this is one
 * thing an agent cannot change by writing a canvas. Only a person's save names a different list.
 */
export const SharedViewIdsSchema = z.array(z.string()).optional();

/* The version this Ruimte writes. A file that says a higher number is not broken, only newer. */
export const PROJECT_VERSION = 3;

export const ProjectDocumentSchema = ProjectContentSchema.extend({
    version: z.literal(PROJECT_VERSION),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative(),
    shared: SharedViewIdsSchema
});
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

/*
 * Views as a file holds them: every entry of an unknown kind back in the shape it was read in. The
 * wire takes either shape, since reading opens an `unknown` entry up again.
 */
export const storedViewsOf = (views: readonly ProjectView[]): unknown[] => views.map(storedViewOf);

/*
 * What `.ruimte/project.json` holds: the identity of the project and the views a person put in git.
 * No rev, because that line changes on every write and would be the one thing that conflicts on
 * every pull; it lives in the private file, which never travels. The list may be empty, which is
 * every project nobody shared anything of.
 */
export const ProjectSharedFileSchema = z.object({
    version: z.literal(PROJECT_VERSION),
    name: z.string().min(1),
    color: z.string(),
    icon: ProjectIconChoiceSchema.optional(),
    views: z.array(ProjectViewSchema)
});
export type ProjectSharedFile = z.infer<typeof ProjectSharedFileSchema>;

/* What one person's node of a shared canvas carries that nobody else can use. */
export const ProjectNodeOverlaySchema = ProjectNodeSchema.pick({
    cwd: true,
    resume: true,
    runtimeMode: true,
    worktree: true,
    path: true
});
export type ProjectNodeOverlay = z.infer<typeof ProjectNodeOverlaySchema>;

export const PROJECT_PRIVATE_VERSION = 1;

/*
 * What `.ruimte/private/project.json` holds, which the `.gitignore` beside it keeps out of the
 * repository: the views only you have, where every row of the sidebar sits, and per shared node the
 * fields that could not travel. One flat map is enough for the last of those, since a view id and a
 * node id are the same namespace.
 */
export const ProjectPrivateFileSchema = z.object({
    version: z.literal(PROJECT_PRIVATE_VERSION),
    // The rev of the whole document, shared file included. Only ever compared on this machine.
    rev: z.number().int().nonnegative(),
    views: z.array(ProjectViewSchema),
    /* Every view id in sidebar order, the shared ones among them. An id the shared file has and
       this list does not falls in behind the one before it, so a view a colleague added arrives in
       the right place without anybody merging an order. */
    order: z.array(z.string()),
    overlay: z.record(z.string(), ProjectNodeOverlaySchema).default({})
});
export type ProjectPrivateFile = z.infer<typeof ProjectPrivateFileSchema>;

export const EMPTY_PRIVATE_FILE: ProjectPrivateFile = { version: PROJECT_PRIVATE_VERSION, rev: 0, views: [], order: [], overlay: {} };

/* What a version-2 file holds: one file for everything, with the rev in it. Read, migrated, never written again. */
export const ProjectDocumentV2Schema = z.object({
    version: z.literal(2),
    rev: z.number().int().nonnegative(),
    name: z.string().min(1),
    color: z.string(),
    icon: ProjectIconChoiceSchema.optional(),
    views: z.array(ProjectViewSchema).min(1)
});
export type ProjectDocumentV2 = z.infer<typeof ProjectDocumentV2Schema>;

/* What a version-1 file holds: one project is one canvas. Read, migrated, never written again. */
export const ProjectDocumentV1Schema = z.object({
    version: z.literal(1),
    rev: z.number().int().nonnegative(),
    name: z.string().min(1),
    color: z.string(),
    icon: ProjectIconChoiceSchema.optional(),
    nodes: z.array(CanvasNodeSchema),
    texts: z.array(ProjectTextSchema),
    edges: z.array(ProjectEdgeSchema),
    layouts: z.array(ProjectLayoutSchema).default([])
});
export type ProjectDocumentV1 = z.infer<typeof ProjectDocumentV1Schema>;

/*
 * What `<folder>/.ruimte/settings.json` says about a project, beside `project.json`. Every field is
 * optional, and a key this version does not know is kept in the file when another is written.
 */
export const ProjectSettingsSchema = z.object({
    worktrees: z
        .object({
            // Paths relative to the project folder, linked into every worktree the daemon makes, such as node_modules.
            share: z.array(z.string().min(1)).optional()
        })
        .optional()
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectSettingsPayloadSchema = z.object({
    folder: z.string().min(1)
});
export type ProjectSettingsPayload = z.infer<typeof ProjectSettingsPayloadSchema>;

// Writes the fields it names and keeps every other key of the file as it was.
export const ProjectSettingsUpdatePayloadSchema = z.object({
    folder: z.string().min(1),
    settings: ProjectSettingsSchema
});
export type ProjectSettingsUpdatePayload = z.infer<typeof ProjectSettingsUpdatePayloadSchema>;

// The surfaces beside the canvas that can be up; the toolbar has a button per kind.
export const ProjectPanelKindSchema = z.enum(['files', 'git', 'processes', 'devices']);
export type ProjectPanelKind = z.infer<typeof ProjectPanelKindSchema>;

// A tab that shows the file's diff instead of the file itself, so both can be open at once.
export const ProjectFileTabViewSchema = z.object({
    kind: z.literal('diff'),
    // The checkout the diff is read from; a bound group's worktree is not the project folder.
    cwd: z.string().min(1),
    scope: GitDiffScopeSchema,
    staged: z.boolean(),
    // The commit the `commit` scope reads; the tab is that whole commit, not one file of it.
    commit: z.string().min(1).optional(),
    // Keeps a worktree diff anchored to the branch it came from after reload.
    base: z.string().min(1).optional()
});
export type ProjectFileTabView = z.infer<typeof ProjectFileTabViewSchema>;

// One file the preview has open. Whether it is edited is view state and stays out of the file.
export const ProjectFileTabSchema = z.object({
    path: z.string().min(1),
    pinned: z.boolean(),
    // Absent means the tab shows the file; the diff tab of the same file carries this.
    view: ProjectFileTabViewSchema.optional()
});
export type ProjectFileTab = z.infer<typeof ProjectFileTabSchema>;

/*
 * How the panels around the canvas stood when this project was last on screen. Every field is
 * optional on its own, so a local file written before the panels moved in here still parses and
 * a field that is missing falls back to what the app defaults to.
 */
export const ProjectPanelsSchema = z.object({
    panel: z.object({ open: z.boolean(), kind: ProjectPanelKindSchema }).optional(),
    preview: z.object({ open: z.boolean() }).optional(),
    // Whole pixels. Absent means the panel opens at the width the app picks for it.
    panelWidth: z.number().int().positive().optional(),
    previewWidth: z.number().int().positive().optional(),
    // The plan the plan panel shows. Whether it is open follows from whether its chat is on screen, never from this file.
    plan: z.object({ chatId: z.string().min(1), planId: z.string().min(1), dismissed: z.boolean() }).optional(),
    planWidth: z.number().int().positive().optional(),
    tabs: z.array(ProjectFileTabSchema).optional(),
    activeTab: z.string().nullable().optional(),
    // What the file tree had open, the way the tree names a directory: relative, POSIX, trailing slash.
    expandedDirs: z.array(z.string()).optional(),
    // The canvases the sidebar has folded open. Absent means the list has never been folded by hand.
    sidebarExpanded: z.array(z.string()).optional(),
    // The last favicon of every browser node, by node id, so a reload draws it before the page loads.
    favicons: z.record(z.string(), z.string()).optional(),
    // The git panel's own state: the scope a diff tab opens in and the folders its list has folded up.
    git: z
        .object({
            scope: GitDiffScopeSchema,
            // Relative to the repository root, POSIX, no trailing slash, as `git.status` names a path.
            collapsedDirs: z.array(z.string()).optional(),
            // Whole pixels the commit log takes at the bottom of the panel.
            logHeight: z.number().int().positive().optional()
        })
        .optional()
});
export type ProjectPanels = z.infer<typeof ProjectPanelsSchema>;

export const CameraSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() });
export type Camera = z.infer<typeof CameraSchema>;

/*
 * A camera the way it is stored: the world point in the middle of the cell and the zoom. The screen
 * offset a `Camera` holds only means something against the size of the cell it was taken in, so a
 * smaller window or another cell would put a different part of the canvas in front.
 */
export const ViewCameraSchema = z.object({
    center: z.object({ x: z.number(), y: z.number() }),
    zoom: z.number().positive()
});
export type ViewCamera = z.infer<typeof ViewCameraSchema>;

/* A camera in the old screen-offset shape cannot be turned around without the viewport it was taken
   in, so it reads as none and the view is fitted once. Accepting it at all keeps an older client
   from having its whole local file refused over one field. */
const StoredViewCameraSchema = z.union([ViewCameraSchema, CameraSchema.transform((): null => null)]).nullable();

// Where one view stood when it was last on screen. Per client, like everything around it.
export const ProjectViewLocalSchema = z.object({
    camera: StoredViewCameraSchema,
    focusedNodeId: z.string().nullable()
});
export type ProjectViewLocal = z.infer<typeof ProjectViewLocalSchema>;

/* One cell shows exactly one view, and a view stands in at most one cell. */
export const SplitCellSchema = z.object({
    viewId: z.string().min(1),
    // Share of its column's height; the cells of a column sum to 1.
    size: z.number().positive()
});
export type SplitCell = z.infer<typeof SplitCellSchema>;

export const SplitColumnSchema = z.object({
    cells: z.array(SplitCellSchema).min(1),
    // Share of the width; the columns sum to 1.
    size: z.number().positive()
});
export type SplitColumn = z.infer<typeof SplitColumnSchema>;

/*
 * How the views of one project stood next to each other on this client: columns of cells, never a
 * free tree. The two limits live in the client's `shell/split.ts` and not here, so a file that was
 * hand-edited past them parses and is trimmed on the way in rather than throwing the layout away.
 */
export const SplitLayoutSchema = z.object({
    columns: z.array(SplitColumnSchema).min(1),
    // Which cell has the focus; the sidebar reads the view in it as the active row.
    focus: z.object({ column: z.number().int().nonnegative(), cell: z.number().int().nonnegative() })
});
export type SplitLayout = z.infer<typeof SplitLayoutSchema>;

/*
 * Per client, never in the shared file: which view was open, where its camera was and what had
 * focus, how the views stood next to each other and how the panels stood. The panels are per
 * project, not per view: they are about the folder, so they stay put while you switch views.
 */
export const ProjectLocalSchema = z.object({
    activeViewId: z.string().nullable(),
    views: z.record(z.string(), ProjectViewLocalSchema),
    panels: ProjectPanelsSchema.optional(),
    /* Absent means one column with one cell on `activeViewId`, which is every file written before
       views could stand side by side and every project that has never been split. */
    layout: SplitLayoutSchema.optional()
});
export type ProjectLocal = z.infer<typeof ProjectLocalSchema>;

/* What a version-1 local file holds: one camera and one focus, for the one canvas there was. */
export const ProjectLocalV1Schema = z.object({
    camera: CameraSchema.nullable(),
    focusedNodeId: z.string().nullable(),
    panels: ProjectPanelsSchema.optional()
});
export type ProjectLocalV1 = z.infer<typeof ProjectLocalV1Schema>;

export const ProjectSummarySchema = z.object({
    projectId: ProjectIdSchema,
    name: z.string(),
    color: z.string(),
    // Null for a canvas that lives in the app data dir instead of a folder.
    folder: z.string().nullable(),
    lastOpenedAt: z.number(),
    /* When a person last closed this project, which is the only thing that moves it out of the list
       of projects in use and under Recent. Null while it belongs in the list; absent from a daemon
       that has no notion of closing, whose projects therefore all read as in use. */
    closedAt: z.number().nullish(),
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
    color: z.string().optional(),
    /* Makes the folder, and every missing folder above it, when nothing is there yet. Only the
       folder picker asks for this; every other caller opens what already exists. */
    createFolder: z.boolean().optional()
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
    content: ProjectContentSchema,
    shared: SharedViewIdsSchema
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

/* A project a person closed. The menu keeps it under Recent until someone opens it again. */
export const isRecentProject = (summary: ProjectSummary): boolean => summary.closedAt !== null && summary.closedAt !== undefined;

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

/*
 * An agent asked for a view to be shown. Making is shared and lands in `project.json`; showing is
 * personal, so this changes no document and every client with the project on screen decides for
 * itself whether to follow it. The caller rides along as an id, never as a title, so a client that
 * wants to name the agent reads the name out of the document it already holds.
 */
export const ProjectShowViewEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    // The node or view the verb ran from: a terminal session, a chat, or a session that is a view of its own.
    by: z.string().min(1)
});
export type ProjectShowViewEvent = z.infer<typeof ProjectShowViewEventSchema>;

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

export const ProjectSetIdentityPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    name: z.string().min(1).optional(),
    icon: ProjectIconChoiceSchema.nullable().optional()
});
export type ProjectSetIdentityPayload = z.infer<typeof ProjectSetIdentityPayloadSchema>;

export const ProjectSummaryResultSchema = z.object({
    summary: ProjectSummarySchema
});
export type ProjectSummaryResult = z.infer<typeof ProjectSummaryResultSchema>;

// The name, color, icon or availability of a project changed; too small to ship a document for.
export const ProjectSummaryEventSchema = ProjectSummaryResultSchema;
export type ProjectSummaryEvent = z.infer<typeof ProjectSummaryEventSchema>;
