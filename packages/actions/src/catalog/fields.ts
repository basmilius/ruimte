import {
    ArtifactKeySchema,
    AgentKindSchema,
    DrawingAlignSchema,
    DrawingColorSchema,
    DrawingFillSchema,
    DrawingFontSchema,
    DrawingStrokeStyleSchema,
    DRAWING_TEXT_SIZE_MAX,
    DRAWING_TEXT_SIZE_MIN,
    LaunchConfigKindSchema,
    ModelSelectionSchema,
    NodeKindSchema,
    NODE_ACCENT_NAMES,
    PROJECT_VIEW_KINDS,
    PlanSchema,
    ROUTINE_LIMITS,
    RoutinePerRunSchema,
    RoutineScheduleSchema,
    RuntimeModeSchema,
    SECRET_VARIABLE_PATTERN,
    UNKNOWN_KIND
} from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_TITLE_LENGTH } from '../limits.ts';

export const ACTION_ACTOR_KINDS = ['person', 'voice', 'agent', 'automation', 'extension'] as const;
export const ActionActorKindSchema = z.enum(ACTION_ACTOR_KINDS);

/* What an action is about. Voice gets one tool per domain, so this is also how its tools are cut. */
export const ACTION_DOMAINS = [
    'workspace',
    'views',
    'canvas',
    'layout',
    'communicate',
    'sessions',
    'plans',
    'agents',
    'projects',
    'developer',
    'files',
    'content',
    'pages',
    'machine'
] as const;
export type ActionDomain = (typeof ACTION_DOMAINS)[number];

/* Every kind a project knows, plus the one a newer Ruimte made. An action may name a view this version cannot open. */
export const ActionViewKindSchema = z.enum([...PROJECT_VIEW_KINDS, UNKNOWN_KIND]);

/* What an action may ask to be made. Shorter than what it can name, and this catalog's own decision. */
export const CREATABLE_VIEW_KINDS = ['canvas', 'drawing', 'diagram', 'terminal', 'browser', 'chat', 'file', 'database', 'separator', 'subheader'] as const;
export const ActionCreatableViewKindSchema = z.enum(CREATABLE_VIEW_KINDS);

export const ActionCanvasNodeKindSchema = z.enum([...NodeKindSchema.options, UNKNOWN_KIND]);

const CREATABLE_CANVAS_NODE_KINDS = ['terminal', 'chat', 'browser', 'group', 'note', 'file'] as const;
export const ActionCreatableCanvasNodeKindSchema = z.enum(CREATABLE_CANVAS_NODE_KINDS);

export const viewId = z.string().min(1);
export const viewName = z.string().trim().min(1);
export const nodeId = z.string().min(1);
/* How often the document read has been written: a write that names it refuses once the document moved on. */
export const revision = z.number().int().min(0);
/*
 * A name a caller gives: a title, the name of a view or a layout, a group label, the word on a line.
 * Every input a person types one in holds the same limit, so a name never fails only once it is sent.
 */
export const givenName = z.string().trim().min(1).max(MAX_TITLE_LENGTH);

/*
 * A field only these actors may fill: what one executor honors and another would drop. Voice's tools
 * leave it out and the registry refuses a value in it from anyone else. Absent reads as null.
 */
export function forActors<Schema extends z.ZodType>(actors: readonly ActionActorKind[], schema: Schema) {
    return schema.nullish().meta({ actors: [...actors] });
}
export function agentField<Schema extends z.ZodType>(schema: Schema) {
    return forActors(['agent'], schema);
}

export function optionalFields<Shape extends z.ZodRawShape>(shape: Shape) {
    return z.object(shape).partial().shape;
}

/* The actors a field or a member of a union is kept for; null when every actor of its action may fill it. */
export function fieldActors(schema: z.ZodType): readonly ActionActorKind[] | null {
    const actors = (schema.meta() as { actors?: unknown } | undefined)?.actors;
    return Array.isArray(actors) ? (actors as ActionActorKind[]) : null;
}

export const ARRANGE_LAYOUTS = ['grid', 'row', 'column'] as const;

/*
 * Kinds a node can only be made as by an agent: a drawing and a diagram mirror a view the daemon names
 * with `source`, and a device shows one this machine has, named with `device`. A person places a view of each.
 */
export const AGENT_NODE_KINDS = ['drawing', 'diagram', 'device'] as const;

/* A node of an artifact this machine keeps in Output, or of a routine of the project, which Voice has no words to name. */
export const OUTPUT_NODE_KINDS = ['artifact', 'routine'] as const;

/* A view only a person makes: a device is picked from a panel of what this machine has attached, and a design's folder and CLI are theirs to pick. */
export const PERSON_VIEW_KINDS = ['device', 'design'] as const;

/* In world units, the canvas's own coordinates, so a camera move does not change where it lands. */
export const worldPoint = z.object({ x: z.number(), y: z.number() });
export const frame = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export const LOCK_GESTURES = ['pan', 'zoom', 'move', 'resize'] as const;
export const PERSON_AND_VOICE: readonly ActionActorKind[] = ['person', 'voice'];
export const PERSON_VOICE_AND_AGENT: readonly ActionActorKind[] = ['person', 'voice', 'agent'];
/* Every actor of a project's own: an extension runs only the actions that name it. */
export const PERSON_VOICE_AGENT_AND_AUTOMATION: readonly ActionActorKind[] = ['person', 'voice', 'agent', 'automation'];
/* What an extension with the permission may run, as an agent's verb, held to the fields an agent gives. */
export const AGENT_AND_EXTENSION: readonly ActionActorKind[] = ['agent', 'extension'];
export const PERSON_VOICE_AGENT_AND_EXTENSION: readonly ActionActorKind[] = ['person', 'voice', 'agent', 'extension'];
/* What only a client runs: no agent reaches a client, so an agent is left out. */
export const CLIENT_ACTORS: readonly ActionActorKind[] = ['person', 'voice', 'automation'];
export const AGENT: readonly ActionActorKind[] = ['agent'];
/* What an agent's verb starts, and Voice and an extension may start too: an AI Chat of the person's own CLI, held to the fields they may give. */
export const AGENT_VOICE_AND_EXTENSION: readonly ActionActorKind[] = ['agent', 'voice', 'extension'];
export const PERSON: readonly ActionActorKind[] = ['person'];
/* What a person's gesture and an agent's verb both do, and Voice has no words for yet. */
export const PERSON_AND_AGENT: readonly ActionActorKind[] = ['person', 'agent'];

/* Only a person hands a CLI session on, from a chat or terminal that runs it; anyone else naming one would take over a session that is not theirs. */
export const resumedSession = forActors(PERSON, z.string().min(1)).describe('The CLI session the chat or terminal goes on with');

/*
 * Plan ids stay plain strings here: the plan store checks them and refuses under its own codes, which
 * an input schema would turn into one invalid-input.
 */
export const planId = z.string().min(1).nullable().describe('The plan by id; without it the newest plan of this chat');
export const PLAN_ITEM_TYPES = ['step', 'text', 'section'] as const;
export const planChanged = z.object({
    plan: PlanSchema,
    // Steps that got their first sub-step, so their own state is gone and follows from their sub-steps.
    dropped: z.array(z.string())
});

/* A person and Voice name the chat a plan belongs to; an agent's plan is always that of its own chat. */
export const planChat = forActors(PERSON_AND_VOICE, z.string().min(1)).describe('The AI Chat whose plans these are');

export const chatTarget = z.string().min(1).describe('The AI Chat view or node, by id');
export const terminalTarget = z.string().min(1).describe('The terminal view or node, by id');
export const chatNamed = z.object({ chatId: z.string(), chat: z.string() });
export const terminalNamed = z.object({ terminalId: z.string(), terminal: z.string() });
export const queuedMessage = z.object({ chatId: chatTarget, messageId: z.string().min(1).describe('The queued message, by the id chat.inspect gives it') });
export const queuedMessageOutput = chatNamed.extend({ messageId: z.string(), text: z.string() });
export const modelOptions = z.record(z.string(), z.union([z.string(), z.boolean()]));
/* The composer hands over the whole selection it built; anyone else names the model and one option. */
export const modelSelection = forActors(PERSON, ModelSelectionSchema).describe('The whole model selection, options and all');
export const questionAnswers = z
    .array(z.object({ questionId: z.string().min(1), answer: z.string().trim().min(1).describe("The answer, in the user's own words") }))
    .min(1);
export const recentMessages = z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string(), createdAt: z.number() }));

/* A flag wears one of the node accents, so the whole app paints from one palette. */
export const flagColor = z.enum(NODE_ACCENT_NAMES);

/* No line runs to a chat view, so naming the canvas is what lets one reach a node there. */
export const operatedView = agentField(viewId).describe(
    'The canvas the node stands on, which a chat view names to read or operate a node there without a line; a node on a canvas leaves it out'
);
export const browserNode = nodeId.describe('The browser node, by id');
export const browserOutcome = z.object({
    nodeId,
    // Whether anyone has the page open; nobody watching is an answer and never an error.
    open: z.boolean(),
    page: z.object({ url: z.string(), title: z.string(), loading: z.boolean(), canGoBack: z.boolean(), canGoForward: z.boolean() }).nullable(),
    error: z.string().nullable()
});

export const deviceNode = nodeId.describe('The device, by the id device.list gives it, or a device node by its id');
export const devicePixel = z.number().min(0).describe('A pixel of the last device shot, counted from its top-left corner');
export const deviceDone = z.object({ nodeId, device: z.string() });
export const deviceElement = z.number().int().min(0).describe('An element by the number in brackets the last device state gave it');
export const deviceSize = z.object({ width: z.number().int(), height: z.number().int() });
export const deviceApp = z.string().trim().min(1).max(256).describe('A bundle id on iOS or a package name on Android');
export const devicePath = z
    .string()
    .min(1)
    .max(4096)
    .describe("A file inside the project folder, its worktrees, the chat's own folder or the system temp folder, relative to the project folder or absolute");

export const computerApp = z.string().min(1).describe('The app: its name, bundle id or pid, as computer apps lists them');
export const computerAppRef = z.object({ name: z.string(), bundleId: z.string().nullable(), pid: z.number().int() });
/* How long a call may hold for a card or the person's pause, which every call that reads or operates an app can meet. */
export const computerHold = {
    wait: z
        .number()
        .int()
        .min(1)
        .max(110)
        .nullish()
        .describe("Seconds the call holds for a card or the person's pause and goes on once they answer or resume; 6 without it")
};
/* Every call that reads or operates an app works behind the person's work unless it asks for the front. */
export const computerFront = {
    front: z
        .boolean()
        .nullish()
        .describe(
            'True brings the app to the front and uses the real pointer and keyboard, which interrupts the person; without it the call works in the background and refuses with needs-front what only the front can do'
        )
};
/* How the tree and the picture of a state are cut, for state itself and for every action that asks for one after it. */
export const computerStateCut = {
    screenshot: z.boolean().nullish().describe('False leaves the picture of the window out'),
    maxDepth: z.number().int().min(1).max(200).nullish().describe('How many levels of the tree to read; 60 without it'),
    maxElements: z.number().int().min(1).max(5000).nullish().describe('How many elements to list; 500 without it'),
    maxText: z.number().int().min(10).max(10_000).nullish().describe('Where a label or value is cut; 100 characters without it')
};
export const computerThenState = {
    ...computerHold,
    ...computerFront,
    withState: z
        .boolean()
        .nullish()
        .describe('After the action, wait until the window settles and answer with what changed against the last tree you got for this app'),
    fullState: z.boolean().nullish().describe('With withState, the whole tree instead of what changed'),
    ...computerStateCut
};
export const computerElement = z.number().int().min(0).describe('An element by the number in brackets the last state gave it');
export const computerPixel = z.number().min(0).describe('A pixel of the last screenshot, counted from its top-left corner');
export const computerState = z.object({
    app: computerAppRef,
    window: z.object({ title: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number(), sheet: z.string().nullable() }),
    // On this machine, outside any project; null when no picture was taken, and screenshotError says why.
    screenshot: z.object({ path: z.string(), width: z.number(), height: z.number(), scale: z.number(), originX: z.number(), originY: z.number() }).nullable(),
    screenshotError: z.string().nullable(),
    elements: z.number().int(),
    tree: z.array(z.string()),
    truncated: z.string().nullable(),
    hidden: z.boolean(),
    note: z.string().nullable(),
    // Set when the tree holds only what changed against the last tree the caller got: `+ ` new, `- ` gone, `~ ` changed.
    diff: z.object({ added: z.number().int(), gone: z.number().int(), changed: z.number().int() }).nullish(),
    // Why the tree is whole where only what changed was asked for.
    full: z.string().nullish(),
    // With find: how many elements hold the text; the other lines are what they sit in.
    matches: z.number().int().nullish(),
    within: z.number().int().nullish()
});
export const computerOutcome = z.object({
    app: computerAppRef.nullable(),
    target: z
        .object({
            role: z.string().nullable(),
            label: z.string().nullable(),
            identifier: z.string().nullable(),
            window: z.string().nullable(),
            sheet: z.string().nullable()
        })
        .nullable(),
    point: z.object({ x: z.number(), y: z.number() }).nullable(),
    // What the helper said it did, one word per fact: method, typed, pressed, launched and the like.
    details: z.record(z.string(), z.string()),
    note: z.string().nullable(),
    settled: z.boolean().nullable(),
    state: computerState.nullable(),
    stateError: z.string().nullable()
});

/*
 * A file on the machine the project runs on: relative to the project folder, or absolute. Voice stays
 * inside that folder; a person names any file a node or a view can show.
 */
export const filePath = z.string().min(1).describe('A file relative to the project folder, or an absolute path inside it');
export const FILE_READ_MAX_LINES = 400;
export const fileLine = z.number().int().min(1);

const DRAWABLE_KINDS = ['rect', 'diamond', 'ellipse', 'arrow', 'line', 'text', 'note'] as const;
export const drawingView = viewId.describe('A drawing view of this project, on screen');
export const diagramView = viewId.describe('A diagram view of this project, on screen');
export const elementIds = z
    .array(z.string().min(1))
    .min(1)
    .nullable()
    .describe('The elements by id, as drawing.read lists them; null for what is selected in the drawing');
/* A finished element in the words Voice has for one; the handler fills in the rest from the dock's style. */
export const newElement = z.object({
    kind: z.enum(DRAWABLE_KINDS),
    x: z.number().describe('The left edge, or where a line or an arrow starts, in drawing units'),
    y: z.number().describe('The top edge, or where a line or an arrow starts'),
    w: z.number().describe('The width; for a line or an arrow how far right its end lies, negative for left'),
    h: z.number().describe('The height; for a line or an arrow how far down its end lies, negative for up'),
    text: z.string().nullable().describe('What a text or a note says; null for a shape'),
    color: DrawingColorSchema.nullable().describe('The stroke, or the paper of a note; null for the color the dock has up')
});
export const drawingStyle = z.object({
    stroke: DrawingColorSchema.nullable(),
    fill: DrawingFillSchema.nullable(),
    fillColor: DrawingColorSchema.nullable(),
    noteColor: DrawingColorSchema.nullable().describe('The paper of a note'),
    strokeWidth: z.literal([1, 2, 4]).nullable(),
    strokeStyle: DrawingStrokeStyleSchema.nullable(),
    roughness: z.literal([0, 1, 2]).nullable().describe('0 is clean, 2 is sloppy'),
    font: DrawingFontSchema.nullable(),
    textSize: z.number().int().min(DRAWING_TEXT_SIZE_MIN).max(DRAWING_TEXT_SIZE_MAX).nullable(),
    align: DrawingAlignSchema.nullable()
});
export const drawingChange = z.object({ viewId, view: z.string(), elementIds: z.array(z.string()) });
export const diagramNodeId = z.string().min(1).describe('A node of the diagram, by the id diagram.read gives it');
/* What a replaced document is written as: one JSON object, the shape the file on disk has. */
export const diagramDocument = z.string().describe('The diagram as one JSON object: meta, nodes, groups and edges');
export const imageFormat = z.enum(['png', 'svg']);

const OPERATION_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export const OperationStatusSchema = z.enum(OPERATION_STATUSES);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

/* The actions that answer with an operation id, which `operation.get` follows. */
export const OPERATION_ACTIONS = ['agent.start', 'team.start'] as const;

export const agentNodeKind = z.enum(['chat', 'terminal']);
export const agentReads = z.array(nodeId).nullable().describe('Nodes the new agent can read from its first turn: a line is drawn from each of them into it');
// A dry run draws nothing, so its lines have no id yet.
export const drawnLine = z.object({ edgeId: z.string().nullable(), from: nodeId, to: nodeId });
export const canvasLine = z.object({ edgeId: z.string(), from: nodeId, to: nodeId, label: z.string().nullable() });
export const worktreeBranch = z.string().min(1).describe('The branch of the worktree');

/*
 * A checkout of the project: the label git.status gives a repository, or the path of a repository or a
 * worktree. A folder can hold several repositories, so an action on one of them names which.
 */
export const repository = z.string().min(1).describe('The repository by the label git.status gives it, or the path of a repository or worktree');
/* What the panel does over the whole folder at once (fetch, pull, push, commit) takes null for all of them. */
export const anyRepository = repository.nullable().describe('One repository by its label or path; null for every repository of the project');
/* The panel names its own run, so the progress it draws and the cancel on its toast reach this one. */
export const gitRun = forActors(PERSON, z.string().min(1)).describe('The id the progress of this run streams under');
export const gitPaths = z.array(z.string().min(1)).min(1).describe('Files relative to the repository root, as git.status names them');
export const gitBranch = z.string().min(1).describe('A branch name as git.refs lists it');
export const gitRunOutput = z.object({
    repository: z.string(),
    path: z.string(),
    // One line of what happened, in the words a person would use.
    summary: z.string(),
    // Everything git wrote.
    output: z.string(),
    commit: z.object({ hash: z.string(), subject: z.string() }).nullable(),
    // The pull request a create-pr opened.
    url: z.string().nullable(),
    // Files git left unmerged: the operation did not fail, it waits in the checkout for a person.
    conflicts: z.array(z.string())
});
/* A run over several repositories goes on past one that fails, so each says how it went. */
export const gitRunsOutput = z.object({
    runs: z.array(gitRunOutput.extend({ error: z.object({ code: z.string(), message: z.string() }).nullable() }))
});
/* How a branch that moved on both sides comes together; only a person decides that, so without it a pull only fast-forwards. */
export const pullStrategy = forActors(PERSON, z.enum(['merge', 'rebase'])).describe('How a branch that moved on both sides comes together');

export const databaseConnection = z
    .string()
    .trim()
    .min(1)
    .describe('The connection by id, or by its name when no other connection of the project carries that name');
export const databaseSchema = z.string().min(1).nullable();
export const languagePath = z
    .string()
    .trim()
    .min(1)
    .describe('The file, relative to the project folder or absolute; it has to be inside the project folder or a worktree of its repository');
export const languageLine = z.number().int().min(1).describe('The line, counting from 1');
export const languageColumn = z.number().int().min(1).describe('The column, counting characters from 1');
const languageServers = z.array(z.object({ kind: z.string(), state: z.string(), message: z.string().optional() }));
export const languageSpan = z.object({
    path: z.string(),
    line: z.number().int(),
    column: z.number().int(),
    endLine: z.number().int(),
    endColumn: z.number().int()
});
export const languageType = languageSpan.extend({ name: z.string(), kind: z.string(), detail: z.string().nullable() });
// What every answer of the language servers says besides itself: the file, whether its text is an editor's, and the servers.
export const languageHead = { path: z.string(), unsaved: z.boolean(), servers: languageServers };
export const DATABASE_QUERY_ROWS = 100;
export const DATABASE_QUERY_MAX_ROWS = 1000;
export const launchName = z.string().trim().min(1).describe('The id of a launch, or its name when no other launch of the project carries that name');
export const launchStarted = z.object({ launchId: z.string(), name: z.string(), kind: LaunchConfigKindSchema, members: z.array(z.string()) });

/* What an agent may give a launch; how it starts with the project and where an import read it from stay a person's. */
export const launchFields = {
    name: givenName.describe('What the launch chip shows it as'),
    command: z.string().trim().min(1).describe('The command its shell runs'),
    cwd: z
        .string()
        .trim()
        .min(1)
        .describe('The folder it runs in, relative to the project folder and inside it or a worktree; the project folder when omitted'),
    url: z.string().trim().min(1).describe('The address of a service, whose port says when it came up'),
    env: z
        .record(z.string().regex(SECRET_VARIABLE_PATTERN), z.string().nullable())
        .describe('Environment variables by name; null removes one. A variable that holds a secret stays the person’s'),
    members: z.array(launchName).min(1).describe('The launches a group starts, in order')
};
export const { name: launchFieldName, ...launchRunFields } = launchFields;
export const launchSaved = z.object({ launchId: z.string(), name: z.string(), kind: LaunchConfigKindSchema, shared: z.boolean() });

export const routineId = z.string().min(1).describe('The id of a routine, from routine_list');
/* What an agent may give a routine; the daemon fills the rest from the caller and from what the routine was. */
export const routineFields = {
    title: z.string().trim().min(1).max(ROUTINE_LIMITS.title).describe('What the person sees the routine and the artifact of its runs as'),
    schedule: RoutineScheduleSchema.describe(
        'When it runs, in the time zone of this machine: once on a day at a time, every week on some days at a time, on some days every so many minutes from one time to another, or a five-field crontab expression that runs at most every 15 minutes'
    ),
    kind: z.enum(['agent', 'command', 'launch']).describe('What each run starts: an agent with a prompt, a command in a shell, or a launch of the project'),
    prompt: z.string().trim().min(1).max(ROUTINE_LIMITS.prompt).describe('What the agent of every run is asked'),
    provider: AgentKindSchema.describe('The CLI of the agent; your own when omitted'),
    model: z.string().trim().min(1).describe('The model of the agent; the default of its CLI when omitted'),
    mode: RuntimeModeSchema.describe('The permission mode of the agent, narrowed to your own; supervised when omitted on a new routine'),
    perRun: RoutinePerRunSchema.describe('new starts every run in a chat of its own with the previous result as context, continue sends every run to one chat'),
    command: z.string().trim().min(1).max(ROUTINE_LIMITS.prompt).describe('The command a shell runs'),
    cwd: z.string().trim().min(1).describe('The folder the command runs in, inside the project folder; the project folder when omitted'),
    launch: launchName,
    key: ArtifactKeySchema.describe('The key of the artifact in Output every run adds a version to; made from the title when omitted')
};
// `mode` is what the routine runs in after the narrowing to the caller's own; null for a command or a launch.
export const routineSaved = z.object({
    routineId: z.string(),
    title: z.string(),
    kind: routineFields.kind,
    mode: RuntimeModeSchema.nullable(),
    shared: z.boolean()
});
export const { title: routineTitle, schedule: routineSchedule, ...routineRunFields } = routineFields;
export const routineNamed = z.object({ routineId: z.string(), title: z.string() });

export const projectMachine = z.string().min(1).describe('The machine, by the endpointId project.list gives');
/* Any machine this client knows, not only the one the project runs on. */
export const givenMachine = z.string().min(1).describe('The machine, by endpointId');
export const listedProjectId = z.string().min(1).describe('The project, by the projectId project.list gives');

export const usageDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* A chat as the agent reading it sees its spend: the model, how full its context is and whether its prompt cache is still warm. */
export const chatReadUsage = z.object({
    provider: AgentKindSchema,
    model: z.string().describe('The model the CLI reported, else the one picked for the chat'),
    contextTokens: z.number().int(),
    contextWindow: z.number().int().nullable().describe('Null when the CLI named no window'),
    contextPercent: z.number().int().nullable().describe('How much of the window the context fills, in whole percent; null without a window'),
    cache: z
        .object({
            ttlMs: z.number().int().nullable().describe('How long the cache lives, in milliseconds'),
            expiresAt: z.iso.datetime(),
            expiresInMs: z.number().int().describe('Negative once the cache went cold'),
            expired: z.boolean()
        })
        .nullable()
        .describe('Null while the CLI names no prompt cache lifetime')
});

export const PaceSchema = z.enum(['ahead', 'behind', 'even']);

export const TARGET_KINDS = ['view', 'node', 'chat', 'agent', 'project'] as const;
export const resolvedTarget = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    viewId: z.string().nullable(),
    view: z.string().nullable(),
    endpointId: z.string().nullable(),
    machine: z.string().nullable()
});

export type ActionActorKind = z.infer<typeof ActionActorKindSchema>;
