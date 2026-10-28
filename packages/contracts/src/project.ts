import { z } from 'zod';
import { isRecord } from '@adecore/agent-contracts';
import { AgentKindSchema } from './agent.ts';
import { GitDiffScopeSchema } from './git.ts';
import { RuntimeModeSchema } from './model.ts';
import { ProviderAccountIdSchema } from './provider-accounts.ts';
import { DeviceReferenceSchema } from './device.ts';
import { DrawingFontSchema, DrawingStrokeStyleSchema, DrawingStrokeWidthSchema } from '@adecore/drawing/protocol';
import { NODE_ACCENT_NAMES } from './node-accents.ts';

export const ProjectIdSchema = z.string().min(1);
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const NodeKindSchema = z.enum(['terminal', 'chat', 'browser', 'device', 'group', 'note', 'drawing', 'diagram', 'file', 'artifact', 'routine']);
export type NodeKind = z.infer<typeof NodeKindSchema>;

// Wraps an entry of a newer version so it is written back verbatim; a reserved kind keeps narrowing useful.
export const UNKNOWN_KIND = 'unknown';

const KNOWN_NODE_KINDS: ReadonlySet<string> = new Set(NodeKindSchema.options);

// The frame a plate is drawn in when the entry does not say. Only used in memory, never written.
const UNKNOWN_NODE_SIZE = { w: 320, h: 200 };

const RawEntrySchema = z.record(z.string(), z.unknown());

// Loose at runtime so a newer Ruimte's field is written back; typed as the known fields so a typo still fails the build.
function keepingUnknown<S extends z.ZodObject>(schema: S): S {
    return schema.loose() as unknown as S;
}

/*
 * A loose pick leaves the keys of the base schema it did not pick unvalidated, since loose keeps every
 * key it has no field for. Those are known to this version and not a newer Ruimte's, so they are dropped.
 */
function pickKeepingUnknown<S extends z.ZodObject, M extends { [K in keyof S['shape']]?: true }, E extends z.ZodRawShape = {}>(
    schema: S,
    mask: M,
    extra?: E
): z.ZodObject<Omit<Pick<S['shape'], Extract<keyof M, keyof S['shape']>>, keyof E> & E, z.core.$loose> {
    const kept = new Set([...Object.keys(mask), ...Object.keys(extra ?? {})]);
    const dropped = Object.keys(schema.shape).filter((key) => !kept.has(key));
    return schema
        .pick(mask as never)
        .extend(extra ?? {})
        .loose()
        .overwrite((value: Record<string, unknown>) => {
            const rest = { ...value };
            for (const key of dropped) {
                delete rest[key];
            }
            return rest;
        }) as never;
}

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function unknownNodeFrameOf(raw: Record<string, unknown>): { id: unknown; title: string; x: number; y: number; w: number; h: number } {
    return {
        id: raw.id,
        title: typeof raw.title === 'string' ? raw.title : String(raw.kind),
        x: finiteOr(raw.x, 0),
        y: finiteOr(raw.y, 0),
        w: positiveOr(raw.w, UNKNOWN_NODE_SIZE.w),
        h: positiveOr(raw.h, UNKNOWN_NODE_SIZE.h)
    };
}

// The id changes when a canvas is copied.
const UNKNOWN_NODE_WRITABLE = ['id', 'x', 'y', 'w', 'h'] as const;

/*
 * An entry of a kind this version does not know, with an id, becomes an `unknown` entry around what
 * it read. An `unknown` entry from the wire is opened up first, so a machine that knows the kind reads
 * the real thing again.
 */
function readEntry(
    value: unknown,
    known: ReadonlySet<string>,
    stored: (entry: Record<string, unknown>) => unknown,
    wrap: (raw: Record<string, unknown>) => unknown
): unknown {
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
}

// `auto`: the session named itself from its first prompt and keeps doing so until a person sets it.
export const NodeTitleSourceSchema = z.enum(['auto', 'user']);
export type NodeTitleSource = z.infer<typeof NodeTitleSourceSchema>;

export const ProjectNodeSchema = keepingUnknown(
    z.object({
        id: z.string().min(1),
        kind: z.union([NodeKindSchema, z.literal(UNKNOWN_KIND)]),
        title: z.string(),
        // Absent on a node nobody named yet, the only state in which its session may still name it.
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
        // Terminal and chat: the account of that CLI on this machine; absent is its default account.
        account: ProviderAccountIdSchema.optional(),
        // Chat only: the CLI was chosen when the node was made, so the composer offers no other one.
        providerFixed: z.boolean().optional(),
        // Terminal only: the permission mode its agent was started in, so a reload starts it the same way.
        runtimeMode: RuntimeModeSchema.optional(),
        // Browser only: the page it shows.
        url: z.string().optional(),
        // Travels with the URL, including shared projects: another machine must not reinterpret its localhost.
        browserOwner: z.string().min(1).optional(),
        // Device only: a portable identity resolved to a local simulator when it is shown.
        device: DeviceReferenceSchema.optional(),
        // Folded to its header, with the height it opens to again. A group also keeps the nodes it held
        // out of sight (`memberIds`, group only); any other node keeps its body as it was, under the header.
        collapsed: z.boolean().optional(),
        memberIds: z.array(z.string()).optional(),
        expandedHeight: z.number().positive().optional(),
        // Group only: the git worktree every node made inside it starts in.
        worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
        // Chat and terminal: the GitHub issue the agent was started on, which the node shows as a pill.
        issue: z.object({ repo: z.string(), number: z.number().int().positive(), url: z.string() }).optional(),
        // Note only: its markdown, and the paper it had before Color covered notes, read as an accent by `notePaperOf` until a person picks a Color, which removes it.
        body: z.string().optional(),
        color: z.string().optional(),
        // Drawing and diagram only: the view of that kind this node mirrors, which lives in the same project.
        viewId: z.string().optional(),
        // File only: relative to the project folder and POSIX, so it holds in another checkout; absolute outside it.
        path: z.string().optional(),
        // Unknown kind only: the entry exactly as it was read.
        raw: RawEntrySchema.optional(),
        // The daemon id of the machine the node runs on. The daemon lays it over what it sends and never writes it to a project file.
        machine: z.string().min(1).optional(),
        // Artifact only: what in Output this machine shows, one person's and kept in the overlay. Without `version` it follows the latest.
        artifact: z.object({ id: z.string().min(1).max(64), version: z.string().min(1).max(64).optional() }).optional(),
        /* Routine only: the id of a routine of the node's own project. It travels in the shared file, since a shared routine's id
           names the same routine for a teammate; a private one's names nothing on their machine, and the node says so. */
        routine: z.string().min(1).max(64).optional()
    })
);
export type ProjectNode = z.infer<typeof ProjectNodeSchema>;

export type CanvasNodeKind = ProjectNode['kind'];

export function isUnknownNode(node: Pick<ProjectNode, 'kind'>): boolean {
    return node.kind === UNKNOWN_KIND;
}

// An unknown node is written as it was read, with whatever a person moved on top.
function storedNodeOf(node: ProjectNode): unknown {
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
}

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
export const ProjectTextSchema = keepingUnknown(
    z.object({
        id: z.string().min(1),
        x: z.number(),
        y: z.number(),
        text: z.string(),
        size: z.number().positive(),
        // Absent means 'sans', the face the app itself is set in.
        font: DrawingFontSchema.optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
        strikethrough: z.boolean().optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
        maxWidth: z.number().positive().optional(),
        color: z.string().optional()
    })
);
export type ProjectText = z.infer<typeof ProjectTextSchema>;

const LINE_STYLE_SCHEMAS = {
    stroke: z.enum(['ink', 'muted', 'accent', ...NODE_ACCENT_NAMES]),
    strokeWidth: DrawingStrokeWidthSchema,
    strokeStyle: DrawingStrokeStyleSchema
};

const LINE_STYLE_DEFAULTS = { stroke: 'ink', strokeWidth: 2, strokeStyle: 'solid' } as const;

type LineStyleKey = keyof typeof LINE_STYLE_SCHEMAS;

const LINE_STYLE_KEYS = Object.keys(LINE_STYLE_SCHEMAS) as LineStyleKey[];

function isReadableLineStyle(key: LineStyleKey, value: unknown): boolean {
    return LINE_STYLE_SCHEMAS[key].safeParse(value).success;
}

const ProjectCanvasLineObjectSchema = keepingUnknown(
    z.object({
        id: z.string().min(1),
        x: z.number().finite(),
        y: z.number().finite(),
        endX: z.number().finite(),
        endY: z.number().finite(),
        ...LINE_STYLE_SCHEMAS,
        arrowStart: z.boolean().optional(),
        arrowEnd: z.boolean().optional(),
        // Only on a line with a style a newer Ruimte wrote: the line exactly as it was read, which reads that style as the default.
        raw: RawEntrySchema.optional()
    })
);

/*
 * A line is written as it was read: a style this version does not know goes back unchanged unless a
 * person picked another one over the default it read as.
 */
function storedLineOf(line: ProjectCanvasLine): unknown {
    const { raw, ...read } = line;
    if (!raw) {
        return line;
    }
    const stored: Record<string, unknown> = { ...raw };
    for (const key of Object.keys(stored)) {
        if (!(key in read)) {
            delete stored[key];
        }
    }
    for (const [key, value] of Object.entries(read)) {
        const kept =
            LINE_STYLE_KEYS.includes(key as LineStyleKey) &&
            !isReadableLineStyle(key as LineStyleKey, raw[key]) &&
            value === LINE_STYLE_DEFAULTS[key as LineStyleKey];
        stored[key] = kept ? raw[key] : value;
    }
    return stored;
}

function readLine(value: unknown): unknown {
    if (!isRecord(value)) {
        return value;
    }
    const entry = isRecord(value.raw) ? storedLineOf(value as ProjectCanvasLine) : value;
    if (!isRecord(entry)) {
        return entry;
    }
    const unreadable = LINE_STYLE_KEYS.filter((key) => !isReadableLineStyle(key, entry[key]));
    if (unreadable.length === 0) {
        return entry;
    }
    return { ...entry, ...Object.fromEntries(unreadable.map((key) => [key, LINE_STYLE_DEFAULTS[key]])), raw: entry };
}

/* Decorative lines never grant an agent context, unlike edges between nodes. */
export const ProjectCanvasLineSchema = z.preprocess(readLine, ProjectCanvasLineObjectSchema);
export type ProjectCanvasLine = z.infer<typeof ProjectCanvasLineObjectSchema>;

export const NodeSideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export type NodeSide = z.infer<typeof NodeSideSchema>;

/*
 * Into an agent's node a line also lets the agent read the source. Loose, so a field a newer Ruimte
 * put on an edge is carried and written back untouched: nothing may rebuild an edge from the fields
 * this version knows.
 */
export const ProjectEdgeSchema = z.looseObject({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
    // A drawn port sticks whatever the nodes do afterwards; an end without one goes where it reads best.
    fromSide: NodeSideSchema.optional(),
    toSide: NodeSideSchema.optional(),
    // A string and not an enum, so a role a newer Ruimte wrote does not fail the whole edge. Read it with `edgeRole`.
    role: z.string().optional()
});
export type ProjectEdge = z.infer<typeof ProjectEdgeSchema>;

/*
 * `context` is the one every version has drawn: the agent it touches reads the other end with
 * `ruimte-context read` and may notify along it; between two agents the head reads. `target` runs from
 * an agent into something it can drive. `origin` only records which node opened another and grants nothing.
 */
export const EDGE_ROLES = ['context', 'target', 'origin'] as const;
export const EdgeRoleSchema = z.enum(EDGE_ROLES);
export type EdgeRole = z.infer<typeof EdgeRoleSchema>;

const KNOWN_EDGE_ROLES: ReadonlySet<string> = new Set(EDGE_ROLES);

// A role this version does not know reads as none, while the word stays on the edge for the Ruimte that wrote it.
export function edgeRole(edge: Pick<ProjectEdge, 'role'>): EdgeRole | null {
    return edge.role !== undefined && KNOWN_EDGE_ROLES.has(edge.role) ? (edge.role as EdgeRole) : null;
}

// A named arrangement: where every node and text sat when it was saved.
export const ProjectLayoutSchema = keepingUnknown(
    z.object({
        name: z.string().min(1),
        nodes: z.record(z.string(), keepingUnknown(z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }))),
        texts: z.record(z.string(), keepingUnknown(z.object({ x: z.number(), y: z.number() })))
    })
);
export type ProjectLayout = z.infer<typeof ProjectLayoutSchema>;

// The names this version offers and draws. Append-only: a renamed name draws nothing on an older Ruimte.
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
    'coffee',
    'pin',
    'target',
    'lightbulb',
    'archive',
    'inbox',
    'house',
    'briefcase',
    'code-xml',
    'braces',
    'square-terminal',
    'file-code',
    'binary',
    'regex',
    'variable',
    'blocks',
    'component',
    'git-branch',
    'git-merge',
    'git-pull-request',
    'git-fork',
    'bug',
    'test-tube-diagonal',
    'flask-conical',
    'workflow',
    'webhook',
    'bot-message-square',
    'brain-circuit',
    'wand-sparkles',
    'messages-square',
    'scan-eye',
    'audio-waveform',
    'app-window',
    'layout-dashboard',
    'layout-template',
    'panels-top-left',
    'mouse-pointer-click',
    'shopping-cart',
    'store',
    'mail',
    'server-cog',
    'cloud-cog',
    'gauge',
    'activity',
    'scroll-text',
    'bell',
    'lock',
    'fingerprint-pattern',
    'chart-line',
    'chart-column',
    'chart-pie',
    'table',
    'sheet',
    'calculator',
    'sigma',
    'atom',
    'dna',
    'telescope',
    'orbit',
    'microchip',
    'keyboard',
    'mouse',
    'headphones',
    'watch',
    'battery',
    'bluetooth',
    'thermometer',
    'pen-tool',
    'pencil-ruler',
    'shapes',
    'frame',
    'swatch-book',
    'type',
    'image',
    'film',
    'clapperboard',
    'mic',
    'notebook',
    'notebook-pen',
    'library-big',
    'newspaper',
    'graduation-cap',
    'languages',
    'quote',
    'presentation',
    'megaphone',
    'list-todo',
    'square-kanban',
    'clipboard-list',
    'calendar',
    'milestone',
    'trophy',
    'hourglass',
    'timer',
    'users',
    'handshake',
    'wallet',
    'sprout',
    'trees',
    'mountain',
    'sun',
    'moon',
    'plane',
    'ship',
    'anchor',
    'life-buoy',
    'pizza',
    'gift',
    'dumbbell',
    'bike',
    'paw-print'
] as const;

export type ProjectIconName = (typeof PROJECT_ICON_NAMES)[number];

export function isProjectIconName(value: string): value is ProjectIconName {
    return (PROJECT_ICON_NAMES as readonly string[]).includes(value);
}

/*
 * A Lucide name as the shared file and the wire carry it: any name, since the list grows with a
 * release and one name an older Ruimte never saw would refuse its whole project list. A name this
 * version does not know draws as if nobody picked one.
 */
export const ProjectIconNameSchema = z.string().min(1).max(64);

// Only a Lucide name: at 14 pixels the app's own line weight is what makes a row of marks read as a
// list. An image is never stored here; it is a file at `.ruimte/icon.<ext>` the derived chain finds.
export const ProjectIconChoiceSchema = z.object({ kind: z.literal('lucide'), value: ProjectIconNameSchema });
export type ProjectIconChoice = z.infer<typeof ProjectIconChoiceSchema>;

/*
 * The choice, or what the daemon derived from the folder. An image's version changes with the file,
 * so `GET /projects/<id>/icon?v=<version>` can be cached forever.
 */
export const ProjectIconSchema = z.discriminatedUnion('kind', [
    ProjectIconChoiceSchema,
    z.object({ kind: z.literal('image'), value: z.string(), version: z.string() }),
    z.object({ kind: z.literal('initial'), value: z.string() })
]);
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;

// The mark a project wears when nothing was picked and the folder declares none.
export function initialIconOf(name: string): ProjectIcon {
    return { kind: 'initial', value: [...name.trim()][0]?.toUpperCase() ?? '?' };
}

// Where the name on screen came from: a person typed it, or it is the folder's own name.
export const ProjectNameSourceSchema = z.enum(['chosen', 'folder']);
export type ProjectNameSource = z.infer<typeof ProjectNameSourceSchema>;

// The one canvas a version-1 file held becomes this view, on every machine that migrates it.
export const MAIN_VIEW_ID = 'main';
export const MAIN_VIEW_NAME = 'Canvas';

/*
 * The node that made this view with a canvas verb; absent on one a person made. In the shared file on
 * purpose, unlike a node's depth: `view delete` only reads it to limit an agent to its own views, and
 * nothing a person does has to be defended with it.
 */
const CreatedBySchema = z.string().min(1).optional();

const ViewBaseSchema = keepingUnknown(
    z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        // The rule a node follows: absent or 'auto' lets the page it hosts name it, 'user' is final.
        titleSource: NodeTitleSourceSchema.optional(),
        // Absent wears the mark of its kind, CLI or favicon; present is a person's choice nothing overrides.
        icon: ProjectIconChoiceSchema.optional(),
        createdBy: CreatedBySchema
    })
);

/*
 * A node without a frame. Its id is the session id, as a node's is, so moving a node between a canvas
 * and a view of its own never restarts anything.
 */
export const StandaloneNodeSchema = pickKeepingUnknown(ProjectNodeSchema, {
    cwd: true,
    command: true,
    resume: true,
    provider: true,
    account: true,
    providerFixed: true,
    runtimeMode: true,
    accent: true,
    issue: true,
    artifact: true
});
export type StandaloneNode = z.infer<typeof StandaloneNodeSchema>;

export const ProjectCanvasViewSchema = ViewBaseSchema.extend({
    kind: z.literal('canvas'),
    // In stacking order, back to front.
    nodes: z.array(CanvasNodeSchema),
    texts: z.array(ProjectTextSchema),
    edges: z.array(ProjectEdgeSchema),
    layouts: z.array(ProjectLayoutSchema).default([]),
    lines: z.array(ProjectCanvasLineSchema).optional(),
    // A canvas a machine keeps for the nodes another machine runs here: no list or tab shows it. The daemon lays it over the document and never writes it to a project file.
    hidden: z.boolean().optional()
});
export type ProjectCanvasView = z.infer<typeof ProjectCanvasViewSchema>;

// A line between sidebar rows. It rides in the view list because the file's order is the list's order.
export const ProjectSeparatorViewSchema = keepingUnknown(
    z.object({
        kind: z.literal('separator'),
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        createdBy: CreatedBySchema
    })
);
export type ProjectSeparatorView = z.infer<typeof ProjectSeparatorViewSchema>;

// A heading over the rows under it; unlike a separator its name is required. It wears no mark.
export const ProjectSubheaderViewSchema = keepingUnknown(
    z.object({
        kind: z.literal('subheader'),
        id: z.string().min(1),
        name: z.string().min(1),
        createdBy: CreatedBySchema
    })
);
export type ProjectSubheaderView = z.infer<typeof ProjectSubheaderViewSchema>;

export const ProjectChatViewSchema = ViewBaseSchema.extend({
    kind: z.literal('chat'),
    node: StandaloneNodeSchema,
    // A Chats project chat nobody wrote in yet: unlisted, reused by the next new chat, cleared by the first message.
    empty: z.boolean().optional(),
    // A chat an inline edit runs in: no list or tab shows it, only its card in the editor.
    hidden: z.boolean().optional()
});
export type ProjectChatView = z.infer<typeof ProjectChatViewSchema>;

// A chat that works on a design: the view shows the HTML files of the folder at `path`, relative to the project folder, beside the thread.
// A further chat of a design, on the same folder, under an id of its own in the one namespace of views and nodes.
export const DesignChatSchema = keepingUnknown(z.object({ id: z.string().min(1), name: z.string().min(1), node: StandaloneNodeSchema }));
export type DesignChat = z.infer<typeof DesignChatSchema>;

/*
 * The folder of a design, relative to the project folder: its name under `.ruimte/private/designs/`
 * while the design is one person's, and under `.ruimte/designs/` once it is shared, so it goes into git
 * with its view. A path with a slash is a folder of the project a design named itself and stays put.
 */
export function designFolderOf(view: Pick<ProjectDesignView, 'path'>, shared: boolean): string {
    return view.path.includes('/') ? view.path : `.ruimte/${shared ? '' : 'private/'}designs/${view.path}`;
}

// The first chat is `node` under the view's own id; `chats` are the ones started after it, oldest first. `path` is the folder's name.
export const ProjectDesignViewSchema = ViewBaseSchema.extend({
    kind: z.literal('design'),
    node: StandaloneNodeSchema,
    path: z.string().min(1),
    chats: z.array(DesignChatSchema).optional()
});
export type ProjectDesignView = z.infer<typeof ProjectDesignViewSchema>;

export const ProjectTerminalViewSchema = ViewBaseSchema.extend({ kind: z.literal('terminal'), node: StandaloneNodeSchema });
export type ProjectTerminalView = z.infer<typeof ProjectTerminalViewSchema>;

export const ProjectBrowserViewSchema = ViewBaseSchema.extend({ kind: z.literal('browser'), url: z.string(), browserOwner: z.string().min(1).optional() });
export type ProjectBrowserView = z.infer<typeof ProjectBrowserViewSchema>;

export const ProjectDeviceViewSchema = ViewBaseSchema.extend({ kind: z.literal('device'), device: DeviceReferenceSchema });
export type ProjectDeviceView = z.infer<typeof ProjectDeviceViewSchema>;

// The elements live in `.ruimte/drawings/<id>.json`, never in this file.
export const ProjectDrawingViewSchema = ViewBaseSchema.extend({ kind: z.literal('drawing') });
export type ProjectDrawingView = z.infer<typeof ProjectDrawingViewSchema>;

// The graph lives in `.ruimte/diagrams/<id>.json`, never in this file.
export const ProjectDiagramViewSchema = ViewBaseSchema.extend({ kind: z.literal('diagram') });
export type ProjectDiagramView = z.infer<typeof ProjectDiagramViewSchema>;

// The path is the whole view: the bytes are the file system's.
export const ProjectFileViewSchema = ViewBaseSchema.extend({ kind: z.literal('file'), path: z.string().min(1) });
export type ProjectFileView = z.infer<typeof ProjectFileViewSchema>;

// As the database last said.
const ProjectTableKindSchema = z.enum(['table', 'view']);

// The connection is a name in the per-machine connection store, so it only resolves where that name exists.
export const ProjectDatabaseViewSchema = ViewBaseSchema.extend({
    kind: z.literal('database'),
    connectionId: z.string().min(1),
    schema: z.string(),
    table: z.string().min(1),
    mode: z.enum(['data', 'structure']),
    // A filtered table is a view of its own, the way it is a tab of its own.
    where: z.string().min(1).optional(),
    tableKind: ProjectTableKindSchema.optional()
});
export type ProjectDatabaseView = z.infer<typeof ProjectDatabaseViewSchema>;

// An Output artifact as a sidebar row. Which artifact is one person's on one machine, so `node.artifact` lives in the private overlay.
export const ProjectArtifactViewSchema = ViewBaseSchema.extend({ kind: z.literal('artifact'), node: StandaloneNodeSchema });
export type ProjectArtifactView = z.infer<typeof ProjectArtifactViewSchema>;

export type ProjectDatabaseTarget = Pick<ProjectDatabaseView, 'connectionId' | 'schema' | 'table' | 'mode' | 'where' | 'tableKind'>;

const KNOWN_VIEW_SCHEMAS = [
    ProjectCanvasViewSchema,
    ProjectChatViewSchema,
    ProjectTerminalViewSchema,
    ProjectBrowserViewSchema,
    ProjectDeviceViewSchema,
    ProjectDrawingViewSchema,
    ProjectDiagramViewSchema,
    ProjectFileViewSchema,
    ProjectDatabaseViewSchema,
    ProjectSeparatorViewSchema,
    ProjectSubheaderViewSchema,
    ProjectArtifactViewSchema,
    ProjectDesignViewSchema
] as const;

export const PROJECT_VIEW_KINDS = KNOWN_VIEW_SCHEMAS.map((schema) => schema.shape.kind.value);

const KNOWN_VIEW_KINDS: ReadonlySet<string> = new Set(PROJECT_VIEW_KINDS);

// A view of a kind a newer Ruimte made: listed, never opened, written back as read. The name falls back to the kind.
export const ProjectUnknownViewSchema = z.object({
    kind: z.literal(UNKNOWN_KIND),
    id: z.string().min(1),
    name: z.string().min(1),
    // Read from the entry so `view delete` still knows the maker; never written from here.
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

export function isCanvasView(view: ProjectView): view is ProjectCanvasView {
    return view.kind === 'canvas';
}

function isSeparatorView(view: ProjectView): view is ProjectSeparatorView {
    return view.kind === 'separator';
}

function isSubheaderView(view: ProjectView): view is ProjectSubheaderView {
    return view.kind === 'subheader';
}

// Neither opens, holds a session or is shared on its own.
export function isDividerView(view: ProjectView): view is ProjectSeparatorView | ProjectSubheaderView {
    return isSeparatorView(view) || isSubheaderView(view);
}

export function isDrawingView(view: ProjectView): view is ProjectDrawingView {
    return view.kind === 'drawing';
}

export function isDiagramView(view: ProjectView): view is ProjectDiagramView {
    return view.kind === 'diagram';
}

export function isFileView(view: ProjectView): view is ProjectFileView {
    return view.kind === 'file';
}

export function isDatabaseView(view: ProjectView): view is ProjectDatabaseView {
    return view.kind === 'database';
}

export function isArtifactView(view: ProjectView): view is ProjectArtifactView {
    return view.kind === 'artifact';
}

export function isUnknownView(view: ProjectView): view is ProjectUnknownView {
    return view.kind === UNKNOWN_KIND;
}

export function viewIconOf(view: ProjectView): ProjectIconChoice | null {
    return isDividerView(view) || view.kind === UNKNOWN_KIND ? null : (view.icon ?? null);
}

// The views that are one session under their own id; drawings, diagrams and files are read off disk.
export function isSessionView(view: ProjectView): view is ProjectChatView | ProjectDesignView | ProjectTerminalView | ProjectBrowserView | ProjectDeviceView {
    return isChatHostView(view) || view.kind === 'terminal' || view.kind === 'browser' || view.kind === 'device';
}

/* The kind of the session a view of its own holds, which for a design is its chat. */
export function sessionKindOfView(
    view: ProjectChatView | ProjectDesignView | ProjectTerminalView | ProjectBrowserView | ProjectDeviceView
): 'chat' | 'terminal' | 'browser' | 'device' {
    return view.kind === 'design' ? 'chat' : view.kind;
}

export function isEmptyChatView(view: ProjectView): view is ProjectChatView {
    return view.kind === 'chat' && view.empty === true;
}

export function isDesignView(view: ProjectView): view is ProjectDesignView {
    return view.kind === 'design';
}

/* A view that holds a chat under its own id: a chat view, and a design, whose chat works on its folder. */
export function isChatHostView(view: ProjectView): view is ProjectChatView | ProjectDesignView {
    return view.kind === 'chat' || view.kind === 'design';
}

/* One chat a view holds outside any canvas: its id, the name it goes by and its node. */
export interface ViewChat {
    id: string;
    name: string;
    node: StandaloneNode;
}

/* Every chat a view holds: a chat view its own, a design its first under the view's id and every later one under its own. */
export function viewChats(view: ProjectView): ViewChat[] {
    if (view.kind === 'chat') {
        return [{ id: view.id, name: view.name, node: view.node }];
    }

    if (view.kind !== 'design') {
        return [];
    }

    return [{ id: view.id, name: view.name, node: view.node }, ...(view.chats ?? []).map((chat) => ({ id: chat.id, name: chat.name, node: chat.node }))];
}

/* The view that holds the chat of this id outside a canvas, with that chat; null for any other id. */
export function chatHostOf(views: readonly ProjectView[], id: string): { view: ProjectChatView | ProjectDesignView; chat: ViewChat } | null {
    for (const view of views) {
        if (!isChatHostView(view)) {
            continue;
        }

        const chat = viewChats(view).find((candidate) => candidate.id === id);

        if (chat !== undefined) {
            return { view, chat };
        }
    }

    return null;
}

export function isHiddenChatView(view: ProjectView): view is ProjectChatView {
    return view.kind === 'chat' && view.hidden === true;
}

function isHiddenView(view: ProjectView): view is ProjectChatView | ProjectCanvasView {
    return (view.kind === 'chat' || view.kind === 'canvas') && view.hidden === true;
}

/* The canvas another machine draws its nodes on, which no agent and no window of this machine works on. */
export function isHiddenCanvasView(view: ProjectView): view is ProjectCanvasView {
    return view.kind === 'canvas' && view.hidden === true;
}

export function isUnlistedView(view: ProjectView): boolean {
    return isEmptyChatView(view) || isHiddenView(view);
}

export function isOpenableView(view: ProjectView): boolean {
    return !isDividerView(view) && view.kind !== UNKNOWN_KIND && !isHiddenView(view);
}

function storedViewOf(view: ProjectView): unknown {
    if (view.kind === UNKNOWN_KIND) {
        return view.raw;
    }
    if (view.kind !== 'canvas') {
        return view;
    }
    return { ...view, nodes: view.nodes.map(storedNodeOf), ...(view.lines ? { lines: view.lines.map(storedLineOf) } : {}) };
}

/*
 * By view or node id, one namespace. A color is a `NODE_ACCENT_NAMES` entry kept as a plain string, so
 * a name a newer Ruimte adds reads as no flag and is still written back; read one with `flagOf`.
 */
export const ProjectFlagsSchema = z.record(z.string().min(1), z.string().min(1));
export type ProjectFlags = z.infer<typeof ProjectFlagsSchema>;

// A null connection is a person's choice to read against no schema at all, whatever the default says.
export const SqlBindingSchema = z.object({
    connectionId: z.string().min(1).nullable(),
    // Absent reads the database the connection starts in.
    database: z.string().min(1).optional()
});
export type SqlBinding = z.infer<typeof SqlBindingSchema>;

// `files` is keyed by stored path. Only ever in the private file, since a choice names a connection.
export const ProjectSqlSchema = z.object({
    default: SqlBindingSchema.optional(),
    files: z.record(z.string().min(1), SqlBindingSchema).optional()
});
export type ProjectSql = z.infer<typeof ProjectSqlSchema>;

// What the person edits; the daemon wraps it with the version and the rev.
export const ProjectContentSchema = z.object({
    name: z.string().min(1),
    color: z.string(),
    // Absent shows what the folder declares.
    icon: ProjectIconChoiceSchema.optional(),
    // In sidebar order. A new project has no views until someone adds one.
    views: z.array(ProjectViewSchema),
    // Only ever in the private file. A save without it keeps the flags on disk, as a client from before flags does.
    flags: ProjectFlagsSchema.optional(),
    // Only ever in the private file. A save without it keeps what is on disk; only `language.sql.bind` changes it.
    sql: ProjectSqlSchema.optional()
});
export type ProjectContent = z.infer<typeof ProjectContentSchema>;

/*
 * The views in the shared file, derived from which file each was read from and never stored as a list.
 * Beside the content and not in it on purpose: a verb hands back content, so an agent cannot change
 * this by writing a canvas. Only a person's save names a different list.
 */
export const SharedViewIdsSchema = z.array(z.string()).optional();

// A file with a higher number is not broken, only newer.
export const PROJECT_VERSION = 3;

export const ProjectDocumentSchema = ProjectContentSchema.extend({
    version: z.literal(PROJECT_VERSION),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative(),
    shared: SharedViewIdsSchema
});
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

// The wire takes either shape, since reading opens an `unknown` entry up again.
export function storedViewsOf(views: readonly ProjectView[]): unknown[] {
    return views.map(storedViewOf);
}

/*
 * `.ruimte/project.json`, what a team commits. No rev: it changes on every write and would conflict on
 * every pull, so it lives in the private file.
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
export const ProjectNodeOverlaySchema = pickKeepingUnknown(
    ProjectNodeSchema,
    {
        cwd: true,
        resume: true,
        account: true,
        runtimeMode: true,
        worktree: true,
        path: true,
        artifact: true
    },
    {
        // The name a session gave a shared node (`title`) or view (`name`): the session is one person's too.
        title: z.string().optional(),
        name: z.string().min(1).optional()
    }
);
export type ProjectNodeOverlay = z.infer<typeof ProjectNodeOverlaySchema>;

export const PROJECT_PRIVATE_VERSION = 1;

/*
 * `.ruimte/private/project.json`, kept out of git by the `.gitignore` beside it. `overlay` is one flat
 * map since a view id and a node id share a namespace.
 */
export const ProjectPrivateFileSchema = z.object({
    version: z.literal(PROJECT_PRIVATE_VERSION),
    // Of the whole document, shared file included. Only ever compared on this machine.
    rev: z.number().int().nonnegative(),
    views: z.array(ProjectViewSchema),
    // Every view id, shared ones included. A shared id missing here falls in behind the one before it in
    // the shared file, so a colleague's view lands in place without merging an order.
    order: z.array(z.string()),
    overlay: z.record(z.string(), ProjectNodeOverlaySchema).default({}),
    // Node fields a newer Ruimte keeps one person's. This version keeps them in the overlay too and never takes them from the shared file.
    overlayFields: z.array(z.string().min(1)).optional(),
    flags: ProjectFlagsSchema.optional(),
    sql: ProjectSqlSchema.optional()
});
export type ProjectPrivateFile = z.infer<typeof ProjectPrivateFileSchema>;

export const EMPTY_PRIVATE_FILE: ProjectPrivateFile = { version: PROJECT_PRIVATE_VERSION, rev: 0, views: [], order: [], overlay: {} };

// One file for everything, with the rev in it. Read, migrated, never written again.
export const ProjectDocumentV2Schema = z.object({
    version: z.literal(2),
    rev: z.number().int().nonnegative(),
    name: z.string().min(1),
    color: z.string(),
    icon: ProjectIconChoiceSchema.optional(),
    views: z.array(ProjectViewSchema).min(1)
});
export type ProjectDocumentV2 = z.infer<typeof ProjectDocumentV2Schema>;

// One project is one canvas. Read, migrated, never written again.
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

export const ProjectPanelKindSchema = z.enum(['files', 'git', 'processes', 'devices']);
export type ProjectPanelKind = z.infer<typeof ProjectPanelKindSchema>;

// The diff of a file, so it can be open beside the file itself.
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

// Makes a `.sql` tab a console on this connection.
export const ProjectConsoleBindingSchema = z.object({
    connectionId: z.string().min(1),
    // Absent runs in the schema the connection starts in.
    schema: z.string().min(1).optional()
});
export type ProjectConsoleBinding = z.infer<typeof ProjectConsoleBindingSchema>;

// Whether it is edited is view state and stays out of the file.
export const ProjectFileTabSchema = z.object({
    path: z.string().min(1),
    pinned: z.boolean(),
    // Absent means the tab shows the file; the diff tab of the same file carries this.
    view: ProjectFileTabViewSchema.optional(),
    console: ProjectConsoleBindingSchema.optional()
});
export type ProjectFileTab = z.infer<typeof ProjectFileTabSchema>;

// A database tab has an id of its own: two tabs may show one table, or a new table has no name yet.
const ProjectDatabaseTabFields = {
    id: z.string().min(1),
    pinned: z.boolean(),
    connectionId: z.string().min(1),
    schema: z.string().min(1)
};
export const ProjectStripTabSchema = z.discriminatedUnion('kind', [
    ProjectFileTabSchema.extend({ kind: z.literal('file') }),
    z.object({
        kind: z.literal('table'),
        ...ProjectDatabaseTabFields,
        table: z.string().min(1),
        // A filtered table, as a jump along a foreign key opens one.
        where: z.string().min(1).optional(),
        tableKind: ProjectTableKindSchema.optional()
    }),
    z.object({ kind: z.literal('structure'), ...ProjectDatabaseTabFields, table: z.string().min(1), tableKind: ProjectTableKindSchema.optional() }),
    // Without a table the designer makes a new one.
    z.object({ kind: z.literal('designer'), ...ProjectDatabaseTabFields, table: z.string().min(1).optional() }),
    // A version of Output, read by the artifact's id; the title is what the tab says until the machine answers.
    // `machineId` names another machine of the account it is kept on; absent is the window's machine.
    z.object({ kind: z.literal('artifact'), artifactId: z.string().min(1), title: z.string(), pinned: z.boolean(), machineId: z.string().min(1).optional() })
]);
export type ProjectStripTab = z.infer<typeof ProjectStripTabSchema>;

// Every field is optional so an older local file parses; a missing one takes the app default.
export const ProjectPanelsSchema = z.object({
    panel: z.object({ open: z.boolean(), kind: ProjectPanelKindSchema }).optional(),
    // A field of its own: a new panel kind would break an older client, so `panel` keeps a kind it knows.
    launchesPanel: z.boolean().optional(),
    // Beside `panel` for the same reason as `launchesPanel`.
    databasesPanel: z.boolean().optional(),
    // Whole pixels.
    panelWidth: z.number().int().positive().optional(),
    // Whether the plan panel is open follows from its chat being on screen, never from this file.
    plan: z.object({ chatId: z.string().min(1), planId: z.string().min(1), dismissed: z.boolean() }).optional(),
    planWidth: z.number().int().positive().optional(),
    // The file tabs alone, for a client from before `strip`.
    tabs: z.array(ProjectFileTabSchema).optional(),
    activeTab: z.string().nullable().optional(),
    // `ProjectStripTabSchema` entries in opening order; the layout says which cell holds each. Read tab by
    // tab, so a kind a newer release adds drops that tab and not the list.
    strip: z.array(z.unknown()).optional(),
    // Relative, POSIX, trailing slash.
    expandedDirs: z.array(z.string()).optional(),
    // The tabs of the databases cell of a release before `strip`, which the client reads into it once.
    databases: z.object({ tabs: z.array(z.unknown()), activeTab: z.string().nullable().optional() }).optional(),
    // Absent means the list was never folded by hand.
    sidebarExpanded: z.array(z.string()).optional(),
    // By node id, so a reload draws a favicon before the page loads.
    favicons: z.record(z.string(), z.string()).optional(),
    git: z
        .object({
            scope: GitDiffScopeSchema,
            // Relative to the repository root, POSIX, no trailing slash, as `git.status` names a path.
            collapsedDirs: z.array(z.string()).optional(),
            // Whole pixels.
            logHeight: z.number().int().positive().optional(),
            // By the label the panel gave them.
            hiddenRepos: z.array(z.string()).optional()
        })
        .optional(),
    // Beside `panel` for the same reason as `launchesPanel`.
    outputPanel: z.boolean().optional()
});
export type ProjectPanels = z.infer<typeof ProjectPanelsSchema>;

export const CameraSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() });
export type Camera = z.infer<typeof CameraSchema>;

// Stored by its center, since a `Camera`'s screen offset only means something in the cell it was taken in.
export const ViewCameraSchema = z.object({
    center: z.object({ x: z.number(), y: z.number() }),
    zoom: z.number().positive()
});
export type ViewCamera = z.infer<typeof ViewCameraSchema>;

// An old screen-offset camera reads as none and the view is fitted once, rather than refusing the whole file.
const StoredViewCameraSchema = z.union([ViewCameraSchema, CameraSchema.transform((): null => null)]).nullable();

// Gestures only: commands (dock buttons, shortcuts) always work.
export const ViewLocksSchema = z.object({
    pan: z.boolean(),
    zoom: z.boolean(),
    move: z.boolean(),
    resize: z.boolean()
});
export type ViewLocks = z.infer<typeof ViewLocksSchema>;

export const ProjectViewLocalSchema = z.object({
    camera: StoredViewCameraSchema,
    focusedNodeId: z.string().nullable(),
    locks: ViewLocksSchema.optional()
});
export type ProjectViewLocal = z.infer<typeof ProjectViewLocalSchema>;

// A view stands in at most one cell and, in a tab host, at most one tab of it.
export const SplitCellSchema = z.object({
    // The active tab of a host, and all an older client reads.
    viewId: z.string().min(1),
    // Present makes the cell a tab host, `viewId` among them.
    tabs: z.array(z.string().min(1)).min(1).optional(),
    // Share of the column's height; a column's cells sum to 1.
    size: z.number().positive()
});
export type SplitCell = z.infer<typeof SplitCellSchema>;

export const SplitColumnSchema = z.object({
    cells: z.array(SplitCellSchema).min(1),
    // Share of the width; the columns sum to 1.
    size: z.number().positive()
});
export type SplitColumn = z.infer<typeof SplitColumnSchema>;

// The limits live in the client's `shell/split.ts`, so a file edited past them is trimmed rather than refused.
export const SplitLayoutSchema = z.object({
    columns: z.array(SplitColumnSchema).min(1),
    // The sidebar reads the view in this cell as the active row.
    focus: z.object({ column: z.number().int().nonnegative(), cell: z.number().int().nonnegative() })
});
export type SplitLayout = z.infer<typeof SplitLayoutSchema>;

// Per client, never in the shared file. Panels are per project, so they stay put across view switches.
export const ProjectLocalSchema = z.object({
    activeViewId: z.string().nullable(),
    views: z.record(z.string(), ProjectViewLocalSchema),
    panels: ProjectPanelsSchema.optional(),
    // Absent means one column with one cell on `activeViewId`.
    layout: SplitLayoutSchema.optional(),
    // Tells closing every view apart from an older client that never saved a layout.
    emptyLayout: z.boolean().optional()
});
export type ProjectLocal = z.infer<typeof ProjectLocalSchema>;

export const ProjectLocalV1Schema = z.object({
    camera: CameraSchema.nullable(),
    focusedNodeId: z.string().nullable(),
    panels: ProjectPanelsSchema.optional()
});
export type ProjectLocalV1 = z.infer<typeof ProjectLocalV1Schema>;

export const ProjectSummarySchema = z
    .object({
        projectId: ProjectIdSchema,
        name: z.string(),
        color: z.string(),
        folder: z.string().min(1),
        lastOpenedAt: z.number(),
        // Set moves it under Recent. Absent from a daemon without closing, whose projects all read as in use.
        closedAt: z.number().nullish(),
        // False when a folder project's file has gone missing since it was last seen.
        available: z.boolean(),
        icon: ProjectIconSchema,
        nameSource: ProjectNameSourceSchema,
        // The machine's Chats project (`project.newChat`). Its folder is the daemon's, so no client shows its path.
        scratch: z.boolean().optional()
    })
    // A name a newer Ruimte picked reads as the initial, the one mark this side can derive without the folder.
    .overwrite((summary) =>
        summary.icon.kind === 'lucide' && !isProjectIconName(summary.icon.value) ? { ...summary, icon: initialIconOf(summary.name) } : summary
    );
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectListResultSchema = z.object({
    projects: z.array(ProjectSummarySchema)
});
export type ProjectListResult = z.infer<typeof ProjectListResultSchema>;

// Opening a folder creates its project file when none exists.
export const ProjectOpenPayloadSchema = z
    .object({
        projectId: ProjectIdSchema.optional(),
        folder: z.string().min(1).optional(),
        name: z.string().optional(),
        color: z.string().optional(),
        // Makes the folder and its missing parents. Only the folder picker asks for this.
        createFolder: z.boolean().optional()
    })
    .refine((payload) => Boolean(payload.projectId || payload.folder), { message: 'A project id or folder is required' });
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

// Made by the daemon in the scratch project so every client holding it sees the chat at once.
export const ProjectNewChatPayloadSchema = z.object({
    provider: AgentKindSchema.optional(),
    account: ProviderAccountIdSchema.optional()
});
export type ProjectNewChatPayload = z.infer<typeof ProjectNewChatPayloadSchema>;

export const ProjectNewChatResultSchema = z.object({
    summary: ProjectSummarySchema,
    viewId: z.string().min(1)
});
export type ProjectNewChatResult = z.infer<typeof ProjectNewChatResultSchema>;

/*
 * A hidden chat view for an edit of selected lines, made with its chat in one write, in the folder of
 * the project or worktree the file is in and in the mode that asks before a change. `path` is stored-path form.
 */
export const ProjectNewInlineChatPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    path: z.string().min(1),
    provider: AgentKindSchema,
    model: z.string().min(1).optional(),
    account: ProviderAccountIdSchema.optional()
});
export type ProjectNewInlineChatPayload = z.infer<typeof ProjectNewInlineChatPayloadSchema>;

export const ProjectNewInlineChatResultSchema = z.object({
    chatId: z.string().min(1),
    viewId: z.string().min(1)
});
export type ProjectNewInlineChatResult = z.infer<typeof ProjectNewInlineChatResultSchema>;

export const ProjectInlineChatTargetPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1)
});
export type ProjectInlineChatTargetPayload = z.infer<typeof ProjectInlineChatTargetPayloadSchema>;

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

// Asked before the confirmation so it can name a number. While `otherClients` is above zero nothing ends.
export const ProjectClosingResultSchema = z.object({
    sessions: z.number(),
    otherClients: z.number()
});
export type ProjectClosingResult = z.infer<typeof ProjectClosingResultSchema>;

// Fields absent from a daemon that answered nothing but an acknowledgement.
export const ProjectCloseResultSchema = z.object({
    ended: z.number().optional(),
    otherClients: z.number().optional()
});
export type ProjectCloseResult = z.infer<typeof ProjectCloseResultSchema>;

export function isRecentProject(summary: ProjectSummary): boolean {
    return summary.closedAt !== null && summary.closedAt !== undefined;
}

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
 * An agent asked for a view to be shown. Showing is personal, so this changes no document and every
 * client decides whether to follow. The caller is an id, never a title; a client reads its name from the document.
 */
export const ProjectShowViewEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    // The node or view the verb ran from.
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

// A project's color as the shared file keeps it.
export const ProjectColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// What a new project gets, and what "Default" in its settings goes back to.
export const DEFAULT_PROJECT_COLOR = '#7c74ff';

export const ProjectSetIdentityPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    name: z.string().min(1).optional(),
    icon: ProjectIconChoiceSchema.nullable().optional(),
    // Written to the shared file, where the color already is; an older machine leaves it out.
    color: ProjectColorSchema.optional()
});
export type ProjectSetIdentityPayload = z.infer<typeof ProjectSetIdentityPayloadSchema>;

export const ProjectSummaryResultSchema = z.object({
    summary: ProjectSummarySchema
});
export type ProjectSummaryResult = z.infer<typeof ProjectSummaryResultSchema>;
