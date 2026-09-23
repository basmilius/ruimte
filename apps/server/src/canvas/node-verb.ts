import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import {
    DEFAULT_TITLES,
    NODE_SIZE,
    isAgentKind,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    storedPathOf,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectDiagramView,
    type ProjectDrawingView,
    type ProjectEdge,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import { z } from 'zod';
import type { IndexedPlace } from '../projects/project-index.ts';
import { ownViewOf, refuseMissingNodes, refuseOwnView } from './own-view.ts';
import { containersOf, groupMembers, placeBeside, placeFree } from './placement.ts';
import { checkCwd, checkPath, isInside } from './project-paths.ts';
import { unescapeText } from './text-escapes.ts';
import {
    DRY_RUN_PREVIEW,
    MAX_TITLE_LENGTH,
    NEW_NODE,
    OPENING_OFF_CANVAS,
    SCOPE_LINE,
    TITLE_LINE,
    VerbRefusal,
    canvasFor,
    defineAction,
    field,
    orNote,
    placeOf,
    titleField
} from './verb.ts';

export const NODE_VERB_KINDS = ['note', 'browser', 'drawing', 'diagram', 'file', 'terminal', 'chat'] as const;
type NodeVerbKind = (typeof NODE_VERB_KINDS)[number];

// A plafond, not a budget: it is there to stop an agent in a loop long before a canvas stops drawing.
export const MAX_CANVAS_NODES = 500;

type KindFlag = 'text' | 'url' | 'path' | 'source' | 'cwd';

// The flags that only mean something on one kind; every kind takes --title, --view and --beside.
const KIND_FLAGS: Record<NodeVerbKind, readonly KindFlag[]> = {
    note: ['text'],
    browser: ['url'],
    drawing: ['source'],
    diagram: ['source'],
    file: ['path'],
    terminal: ['cwd'],
    chat: ['cwd']
};

const REQUIRED_FLAG: Partial<Record<NodeVerbKind, KindFlag>> = { browser: 'url', drawing: 'source', diagram: 'source', file: 'path' };

/* Which kinds a flag goes with, from the same table `run` refuses against, so help cannot claim another pairing. */
const kindsFor = (flag: KindFlag): string =>
    NODE_VERB_KINDS.filter((kind) => KIND_FLAGS[kind].includes(flag))
        .map((kind) => (REQUIRED_FLAG[kind] === flag ? `${kind} (required)` : kind))
        .join(', ');

/* What the title falls back to without `--title`, in the order `run` picks it. */
const untitled = (kind: NodeVerbKind): string => {
    if (kind === 'drawing' || kind === 'diagram') {
        return `the name of the ${kind} view`;
    }
    if (kind === 'file') {
        return "the file's own name";
    }
    return `"${DEFAULT_TITLES[kind]}"`;
};

/* The line about one kind, in help and in a refusal about that kind, so both name the same flags. */
const kindLine = (kind: NodeVerbKind): string =>
    `kind\t${kind}\t${KIND_FLAGS[kind].map((flag) => `--${flag}${REQUIRED_FLAG[kind] === flag ? ' (required)' : ''}`).join(', ')}\tcalled ${untitled(kind)} without --title`;

/* The three flags no kind is without; a refusal about one kind would otherwise read as if they were gone. */
const EVERY_KIND_LINE = 'kind\tevery kind\t--title T, --view V, --beside N';

const KIND_MESSAGE = `node new needs a kind: ${NODE_VERB_KINDS.join(', ')}`;

const NODE_DETAIL: readonly string[] = [
    `argument\t<kind>\trequired\t${NODE_VERB_KINDS.join(', ')}`,
    'prints\tid\tkind\tview\tedge\tthe id of the new node, its kind, the canvas it landed on and the id of the line drawn from you into it (- when none was drawn)',
    ...NODE_VERB_KINDS.map(kindLine),
    EVERY_KIND_LINE,
    `flag\t--title T\tevery kind\tThe title, at most ${MAX_TITLE_LENGTH} characters; one set here is the node's for good, the session never renames over it`,
    'flag\t--view V\tevery kind\tThe canvas to add to, by view id; ruimte-context view list lists them',
    'flag\t--beside N\tevery kind\tPuts the node directly right of node N, top edges level, whatever is there already',
    `flag\t--dry-run\tno value\tChecks everything and makes nothing; the first field is dry-run instead of the id the node would have got and the last names the line it would draw, as <from> -> <new node>; ${DRY_RUN_PREVIEW}`,
    `flag\t--text B\t${kindsFor('text')}\tThe body; \\n, \\t and \\\\ are read as escapes, and --text - takes the body from stdin, byte for byte`,
    `flag\t--url U\t${kindsFor('url')}\tAn http or https address`,
    `flag\t--source V\t${kindsFor('source')}\tThe id of a view of this project of the same kind as the node, a drawing for a drawing and a diagram for a diagram; ruimte-context view list lists them`,
    `flag\t--path P\t${kindsFor('path')}\tThe file to show; it has to exist`,
    `flag\t--cwd P\t${kindsFor('cwd')}\tThe directory the shell starts in`,
    'edge\tA line is drawn from you into the new node, so the canvas says where it came from and not only that it is there',
    'edge\tInto a terminal or a chat that line is context, the direction that makes you readable to it: it can run ruimte-context read on your id',
    'edge\tInto a note, a browser, a file, a drawing or a diagram it is an origin line, which says you put the node there and nothing else; it gives you nothing over it',
    'edge\tOnly a node on that canvas gets one: a chat that is a view of its own, or a node of another canvas, gets no line and the edge column shows -',
    'edge\tOne way only: you do not read the new node through it. ruimte-context link new --to <its id> draws the line back when you want that too',
    'edge\truimte-context link list lists what is drawn on the canvas now',
    'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one, and what it adds gets no line',
    'where\tWithout --beside the first free spot right of the caller, or right of everything when the caller is not on that canvas',
    'paths\t--path and --cwd are resolved against the project folder, never against your own directory; both may also be absolute',
    'paths\t--cwd has to stay inside the project folder or a worktree of its repository; --path may point outside and is then stored absolute',
    `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes; a terminal or chat starts no process until a client shows it`,
    TITLE_LINE
];

/* The same sentence wherever a canvas is full: what is on it, what this call needs, and the cap. */
export const canvasFull = (canvas: ProjectCanvasView, adding: number): VerbRefusal =>
    new VerbRefusal(
        'canvas-full',
        `${canvas.name} holds ${canvas.nodes.length} nodes and this would add ${adding} more; a canvas holds at most ${MAX_CANVAS_NODES}`
    );

// What a caller may pick instead of a --beside that is nowhere; a full canvas would bury the refusal, so it says where to look.
const BESIDE_LINES_MAX = 20;

/*
 * What a refusal about a node id may offer instead. `takes` is what the verb that refused would
 * actually accept, since an alternative that is refused a line later is worse than no list at all,
 * and `empty` is what to say when that leaves nothing.
 */
export const nodeLines = (canvas: ProjectCanvasView, options: { takes?: (node: ProjectNode) => boolean; empty?: string } = {}): string[] => {
    const nodes = options.takes === undefined ? canvas.nodes : canvas.nodes.filter(options.takes);
    if (nodes.length > BESIDE_LINES_MAX) {
        return [`detail\truimte-context node list\tthe ${canvas.nodes.length} nodes of ${canvas.id}`];
    }
    return orNote(
        nodes.map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
        options.empty ?? `${canvas.id} has no nodes on it yet`
    );
};

/* A group is never one of --nodes: `node group` and `node arrange` both refuse one, so neither offers one. */
export const NOT_A_GROUP = {
    takes: (node: ProjectNode): boolean => node.kind !== 'group',
    empty: 'This canvas holds nothing but frames, and a frame is never one of --nodes'
};

/*
 * The ids of a comma-separated flag, in the order they were written and without the repeats: naming
 * a node twice is one node, the way a person's selection holds it once.
 */
export const idList = (raw: string, flag: string): string[] => {
    const ids = [...new Set(raw.split(',').map((id) => id.trim()))];
    if (ids.some((id) => id === '')) {
        throw new VerbRefusal('bad-arguments', `${flag} has an empty id in it; write the ids separated by commas, as a,b,c`);
    }
    return ids;
};

/* The nodes those ids name on this canvas, refused with what this verb takes when one of them names none. */
export const nodesNamed = (
    content: Pick<ProjectContent, 'views'>,
    canvas: ProjectCanvasView,
    ids: readonly string[],
    options: { takes?: (node: ProjectNode) => boolean; empty?: string; cannot?: string } = {}
): ProjectNode[] => {
    const missing = ids.filter((id) => !canvas.nodes.some((node) => node.id === id));
    if (missing.length > 0) {
        throw refuseMissingNodes(content, missing, canvas.id, options.cannot ?? 'there is no node under that id', nodeLines(canvas, options));
    }
    return ids.map((id) => canvas.nodes.find((node) => node.id === id)!);
};

/* Every id the project already uses, since a node id is also a session id and a view id is too. */
const idsIn = (content: ProjectContent): Set<string> => {
    const ids = new Set<string>();
    for (const view of content.views) {
        ids.add(view.id);
        if (isCanvasView(view)) {
            for (const item of [...view.nodes, ...view.texts, ...view.edges]) {
                ids.add(item.id);
            }
        }
    }
    return ids;
};

/* A fresh id in the shape the client's `nextId` gives: a prefix, a dash, eight base-36 characters.
   `also` is what the same mutation already handed out and has not written down yet. */
export const newId = (prefix: string, content: ProjectContent, also: readonly string[] = []): string => {
    const taken = idsIn(content);
    for (const id of also) {
        taken.add(id);
    }
    for (;;) {
        const id = `${prefix}-${Array.from(randomBytes(8), (byte) => (byte % 36).toString(36)).join('')}`;
        if (!taken.has(id)) {
            return id;
        }
    }
};

export const checkUrl = (url: string): string => {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new VerbRefusal('bad-url', `${url} is not a URL; --url takes a whole http or https address, scheme and all`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new VerbRefusal('bad-url', `${url} is not an http or https address; a browser node opens nothing else`);
    }
    return parsed.href;
};

/*
 * The line `node new` draws from whoever called it into what it made. A terminal or a chat reads
 * what a line brings it, so it gets the context line `agent` draws, label and all; nothing else
 * reads, so its line carries the role that says who put the node there and nothing more.
 */
export const openingEdge = (from: string, node: ProjectNode, content: ProjectContent): ProjectEdge => {
    const id = newId('edge', content, [node.id]);
    if (isAgentKind(node.kind)) {
        return { id, from, to: node.id, label: 'context' };
    }
    return { id, from, to: node.id, role: 'origin' };
};

export const nodeNewAction = defineAction('node', {
    name: 'new',
    usage: `<${NODE_VERB_KINDS.join('|')}> [--title T] [--text B] [--url U] [--path P] [--source V] [--cwd P] [--view V] [--beside N] [--dry-run]`,
    // The required flags are in the summary too: without them the first thing a first-time caller meets is a refusal.
    summary: `Adds one node to a canvas, with a line from you into it, and prints id, kind, view, edge; ${Object.entries(REQUIRED_FLAG)
        .map(([kind, flag]) => `a ${kind} needs --${flag}`)
        .join(', ')}`,
    detail: NODE_DETAIL,
    dryRun: true,
    positionals: z.tuple([z.enum(NODE_VERB_KINDS, { error: KIND_MESSAGE })], {
        error: (issue) => (issue.code === 'too_big' ? 'node new takes one kind and nothing else; a title goes in --title' : KIND_MESSAGE)
    }),
    flags: z.object({
        title: titleField('--title', '--title needs a title').optional(),
        text: z.string().transform(unescapeText).optional(),
        url: z.string().min(1, '--url needs an http or https address').optional(),
        path: z.string().min(1, '--path needs the path of a file').optional(),
        source: z.string().min(1, '--source needs the id of a drawing or diagram view').optional(),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional(),
        beside: z.string().min(1, '--beside needs the id of a node on that canvas').optional()
    }),
    async run({ positionals: [kind], flags, dryRun }, call) {
        const place = placeOf(call);
        const kindLines = [kindLine(kind), EVERY_KIND_LINE];
        for (const flag of ['text', 'url', 'path', 'source', 'cwd'] as const) {
            if (flags[flag] !== undefined && !KIND_FLAGS[kind].includes(flag)) {
                throw new VerbRefusal('flag-not-for-kind', `--${flag} does not go with a ${kind} node`, kindLines);
            }
        }
        const required = REQUIRED_FLAG[kind];
        if (required && flags[required] === undefined) {
            throw new VerbRefusal('missing-flag', `A ${kind} node needs --${required}`, kindLines);
        }

        // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
        const url = flags.url === undefined ? undefined : checkUrl(flags.url);
        const path = flags.path === undefined ? undefined : await checkPath(place.folder, flags.path);
        const cwd = flags.cwd === undefined ? undefined : await checkCwd(place.folder, flags.cwd, (folder) => call.host.worktreePaths(folder));

        return call.host.mutate(place.projectId, async (content) => {
            const canvas = canvasFor(content, place, flags.view, OPENING_OFF_CANVAS);
            if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, 1);
            }
            let sourceName: string | undefined;
            if (flags.source !== undefined) {
                // Only a drawing or a diagram takes --source, and each mirrors a view of its own kind.
                const sourceKind = kind === 'diagram' ? 'diagram' : 'drawing';
                const ofKind = (view: ProjectView): view is ProjectDrawingView | ProjectDiagramView =>
                    sourceKind === 'diagram' ? isDiagramView(view) : isDrawingView(view);
                const source = content.views.find((view) => view.id === flags.source);
                if (!source || !ofKind(source)) {
                    throw new VerbRefusal(
                        `not-a-${sourceKind}`,
                        `${flags.source} is not a ${sourceKind} view of this project`,
                        orNote(
                            content.views.filter(ofKind).map((view) => `${sourceKind}\t${view.id}\t${field(view.name)}`),
                            sourceKind === 'diagram'
                                ? 'This project has no diagram views; ruimte-context view new --kind diagram makes one'
                                : 'This project has no drawing views; a person makes one in the sidebar'
                        )
                    );
                }
                sourceName = source.name;
            }
            const size = NODE_SIZE[kind];
            const anchor = flags.beside === undefined ? undefined : canvas.nodes.find((node) => node.id === flags.beside);
            if (flags.beside !== undefined && !anchor) {
                throw refuseMissingNodes(content, [flags.beside], canvas.id, 'the new node has nothing there to stand beside', nodeLines(canvas));
            }
            const caller = canvas.nodes.find((node) => node.id === call.caller) ?? null;
            const rect = anchor ? placeBeside(anchor, size) : placeFree(canvas.nodes, size, caller);
            if (dryRun) {
                // The ends rather than the word "edge": the direction is the thing to check before anything is made.
                return { content: null, result: [`dry-run\t${kind}\t${canvas.id}\t${caller ? `${caller.id} -> ${NEW_NODE}` : '-'}`] };
            }

            const id = newId(kind, content);
            /* Written down under the project's lock, before the node is on disk: who made a node is
               the whole of the rule `node delete` follows, and it may not arrive after the node does. */
            await call.host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: call.caller, depth: 0, agent: false });
            const node: ProjectNode = {
                id,
                kind,
                title: flags.title ?? sourceName ?? (path === undefined ? DEFAULT_TITLES[kind] : basename(path)),
                // A title the agent chose is not one the session may rename, the rule a person's typing follows.
                ...(flags.title === undefined ? {} : { titleSource: 'user' as const }),
                ...rect,
                ...(flags.text === undefined ? {} : { body: flags.text }),
                ...(url === undefined ? {} : { url }),
                ...(path === undefined ? {} : { path: place.folder !== null && isInside(place.folder, path) ? storedPathOf(place.folder, path) : path }),
                ...(flags.source === undefined ? {} : { viewId: flags.source }),
                ...(cwd === undefined ? {} : { cwd })
            };
            const edge = caller ? openingEdge(caller.id, node, content) : null;
            return {
                content: {
                    ...content,
                    views: content.views.map((view) =>
                        view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, node], edges: edge ? [...canvas.edges, edge] : canvas.edges } : view
                    )
                },
                result: [`${id}\t${kind}\t${canvas.id}\t${edge?.id ?? '-'}`]
            };
        });
    }
});

/*
 * What this refusal may offer: the nodes on the caller's own canvas that this same call would
 * actually remove. The caller's own node is left out, since `deletes-caller` refuses it two lines
 * later, and so is every node the caller did not make unless the machine frees them.
 */
const deletableLines = (
    content: ProjectContent,
    place: IndexedPlace,
    call: { caller: string; madeBy(id: string): string | null; anyNode: boolean }
): string[] => {
    const canvas = place.canvasId === null ? undefined : content.views.find((view) => view.id === place.canvasId);
    if (canvas === undefined || !isCanvasView(canvas)) {
        return ['detail\truimte-context node list --view <id>\tthe nodes of a canvas, which is where an id comes from'];
    }
    return nodeLines(canvas, {
        takes: (node) => node.id !== call.caller && (call.anyNode || call.madeBy(node.id) === call.caller),
        empty: `You have no node on ${canvas.id} to remove; node delete takes a node you made yourself`
    });
};

export const nodeDeleteAction = defineAction('node', {
    name: 'delete',
    usage: '<nodeId>',
    summary: 'Removes a node you made, with the session it holds and the lines that ran into it',
    detail: [
        'argument\t<nodeId>\trequired\tThe node to remove, by id; ruimte-context node list lists them',
        'prints\tdeleted\tid\tkind\ttitle\tthe node that went',
        'prints\tended\tid\tkind\tthe session it took with it, for a terminal or a chat',
        'prints\tedges\tcount\thow many lines ran into or out of it and went with it',
        'prints\tmembers\tcount\tfor a group: how many nodes stood in the frame and stayed where they are',
        'rule\tOnly a node whose maker is you, which is every node you made with node new, node group, agent or team',
        'rule\tA machine can free every node and view of every project on it; a refusal says whether this one does',
        'rule\tNever your own node, since that would end the session asking',
        'group\tRemoving a group takes the frame and nothing else: the nodes inside it stay where they stand, because they are not yours to remove with it',
        'note\tThe node is found on any canvas of this project, so this takes no --view',
        'see\truimte-context node list\tthe nodes of a canvas, with the ids this takes'
    ],
    positionals: z.tuple([z.string().min(1, 'node delete needs the id of a node')], {
        error: (issue) => (issue.code === 'too_big' ? 'node delete takes one node id and nothing else' : 'node delete needs the id of a node')
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const place = placeOf(call);
        const anyNode = call.host.agentsDeleteAnyView();
        const madeBy = call.host.madeBy(id);
        return call.host.mutate(place.projectId, async (content) => {
            const canvas = content.views.filter(isCanvasView).find((view) => view.nodes.some((node) => node.id === id));
            const node = canvas?.nodes.find((candidate) => candidate.id === id);
            if (!canvas || !node) {
                const lines = deletableLines(content, place, { caller: call.caller, madeBy: (candidate) => call.host.madeBy(candidate), anyNode });
                const own = ownViewOf(content, id);
                if (own) {
                    throw refuseOwnView(own, 'there is no node to remove', [
                        ...lines,
                        `see\truimte-context view delete ${id}\tremoves a view you made, with the session it holds`
                    ]);
                }
                throw new VerbRefusal('unknown-node', `${id} is not a node on any canvas of this project`, lines);
            }
            if (id === call.caller) {
                throw new VerbRefusal('deletes-caller', `You are ${id}, so removing it would end the session asking`);
            }
            if (!anyNode && madeBy !== call.caller) {
                throw new VerbRefusal('not-yours', `${id} was made by ${madeBy ?? 'a person'} and node delete only removes a node you made yourself`, [
                    `made by\t${madeBy ?? 'a person'}`,
                    `you\t${call.caller}`,
                    "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node and view; a person turns it on from the Machines pane"
                ]);
            }

            const edges = canvas.edges.filter((edge) => edge.from !== id && edge.to !== id);
            /* A collapsed frame keeps its members by id, so a node that goes has to leave those lists
               too; nothing reads geometry while a group is shut. */
            const nodes = canvas.nodes
                .filter((candidate) => candidate.id !== id)
                .map((candidate) =>
                    candidate.memberIds?.includes(id) ? { ...candidate, memberIds: candidate.memberIds.filter((member) => member !== id) } : candidate
                );
            const members = node.kind === 'group' ? groupMembers(node, canvas.nodes).length : 0;
            if (node.kind === 'terminal' || node.kind === 'chat') {
                // Before the write, the rule view delete follows: a shell that outlived its node would answer to nothing.
                await call.host.endSession(node.kind, node.id);
            }
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, nodes, edges } : view)) },
                result: [
                    `deleted\t${id}\t${node.kind}\t${field(node.title)}`,
                    ...(node.kind === 'terminal' || node.kind === 'chat' ? [`ended\t${id}\t${node.kind}`] : []),
                    `edges\t${canvas.edges.length - edges.length}`,
                    ...(node.kind === 'group' ? [`members\t${members}\tleft where they stand`] : [])
                ]
            };
        });
    }
});

export const nodeListAction = defineAction('node', {
    name: 'list',
    usage: '[--view V]',
    summary: 'Lists the nodes of a canvas: id, kind, title, x, y, w, h, group',
    detail: [
        'flag\t--view V\toptional\tThe canvas to list, by view id; ruimte-context view list lists them',
        'prints\tid\tkind\ttitle\tx\ty\tw\th\tgroup\tone line per node, rounded to whole pixels',
        'units\tx and y are the top left corner of the node in canvas pixels, w and h its size; the canvas has no edges and x or y may be negative',
        'where\tWithout --view the view you are in, when that is a canvas; from any other view, name one with --view',
        'self\tThe last row is not a node: it is self and your own id, or self and a dash when none of these nodes is you',
        'self\tA terminal session also carries its own id in $RUIMTE_SESSION_ID; a chat backend is given none, which is what the self row is for',
        'groups\tA group is a row of kind group; its id is what --group takes on agent, and the group column names the frame a node stands in, empty on the canvas itself',
        'see\truimte-context link list\tthe lines of the same canvas, which this list does not show',
        'note\tA tab or a newline in a title is printed as a space, so a node is always one row',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'node list takes no arguments, only flags' }),
    flags: z.object({ view: z.string().min(1, '--view needs the id of a canvas').optional() }),
    async run({ flags }, call) {
        const place = placeOf(call);
        const canvas = canvasFor(await call.host.read(place.projectId), place, flags.view);
        const containers = containersOf(canvas.nodes);
        const mine = canvas.nodes.some((node) => node.id === call.caller);
        return [
            ...canvas.nodes.map((node) =>
                [
                    node.id,
                    node.kind,
                    field(node.title),
                    ...[node.x, node.y, node.w, node.h].map((value) => String(Math.round(value))),
                    containers.get(node.id)?.id ?? ''
                ].join('\t')
            ),
            // Which row is the caller, which it can read nowhere else: a chat backend has no $RUIMTE_SESSION_ID.
            mine ? `self\t${call.caller}` : 'self\t-\tnone of these nodes is you'
        ];
    }
});
