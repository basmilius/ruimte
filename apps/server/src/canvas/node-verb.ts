import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import {
    DEFAULT_TITLES,
    NODE_SIZE,
    isCanvasView,
    isDrawingView,
    storedPathOf,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectNode
} from '@ruimte/contracts';
import { z } from 'zod';
import type { IndexedPlace } from '../projects/project-index.ts';
import { groupMembers, placeBeside, placeFree } from './placement.ts';
import { checkCwd, checkPath, isInside } from './project-paths.ts';
import { unescapeText } from './text-escapes.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, VerbRefusal, canvasFor, defineSubVerb, defineVerb, field, orNote, placeOf, titleField, type Verb } from './verb.ts';

export const NODE_VERB_KINDS = ['note', 'browser', 'drawing', 'file', 'terminal', 'chat'] as const;
type NodeVerbKind = (typeof NODE_VERB_KINDS)[number];

// A plafond, not a budget: it is there to stop an agent in a loop long before a canvas stops drawing.
export const MAX_CANVAS_NODES = 500;

type KindFlag = 'text' | 'url' | 'path' | 'source' | 'cwd';

// The flags that only mean something on one kind; every kind takes --title, --view and --beside.
const KIND_FLAGS: Record<NodeVerbKind, readonly KindFlag[]> = {
    note: ['text'],
    browser: ['url'],
    drawing: ['source'],
    file: ['path'],
    terminal: ['cwd'],
    chat: ['cwd']
};

const REQUIRED_FLAG: Partial<Record<NodeVerbKind, KindFlag>> = { browser: 'url', drawing: 'source', file: 'path' };

/* Which kinds a flag goes with, from the same table `run` refuses against, so help cannot claim another pairing. */
const kindsFor = (flag: KindFlag): string =>
    NODE_VERB_KINDS.filter((kind) => KIND_FLAGS[kind].includes(flag))
        .map((kind) => (REQUIRED_FLAG[kind] === flag ? `${kind} (required)` : kind))
        .join(', ');

/* What the title falls back to without `--title`, in the order `run` picks it. */
const untitled = (kind: NodeVerbKind): string => {
    if (kind === 'drawing') {
        return 'the name of the drawing view';
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

const KIND_MESSAGE = `node needs a kind: ${NODE_VERB_KINDS.join(', ')}`;

const NODE_DETAIL: readonly string[] = [
    `argument\t<kind>\trequired\t${NODE_VERB_KINDS.join(', ')}`,
    'prints\tid\tkind\tview\tthe id of the new node, its kind, and the canvas it landed on',
    ...NODE_VERB_KINDS.map(kindLine),
    EVERY_KIND_LINE,
    `flag\t--title T\tevery kind\tThe title, at most ${MAX_TITLE_LENGTH} characters; one set here is the node's for good, the session never renames over it`,
    'flag\t--view V\tevery kind\tThe canvas to add to, by view id; ruimte-context views lists them',
    'flag\t--beside N\tevery kind\tPuts the node directly right of node N, top edges level, whatever is there already',
    'flag\t--dry-run\tno value\tChecks everything and makes nothing; the first field is dry-run instead of the id the node would have got',
    `flag\t--text B\t${kindsFor('text')}\tThe body; \\n, \\t and \\\\ are read as escapes, and --text - takes the body from stdin, byte for byte`,
    `flag\t--url U\t${kindsFor('url')}\tAn http or https address`,
    `flag\t--source V\t${kindsFor('source')}\tThe id of a drawing view of this project; ruimte-context views lists them`,
    `flag\t--path P\t${kindsFor('path')}\tThe file to show; it has to exist`,
    `flag\t--cwd P\t${kindsFor('cwd')}\tThe directory the shell starts in`,
    'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one',
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
        return [`detail\truimte-context nodes\tthe ${canvas.nodes.length} nodes of ${canvas.id}`];
    }
    return orNote(
        nodes.map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
        options.empty ?? `${canvas.id} has no nodes on it yet`
    );
};

/* A group is never one of --nodes: `group` and `arrange` both refuse one, so neither offers one. */
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
    canvas: ProjectCanvasView,
    ids: readonly string[],
    options: { takes?: (node: ProjectNode) => boolean; empty?: string } = {}
): ProjectNode[] => {
    const missing = ids.filter((id) => !canvas.nodes.some((node) => node.id === id));
    if (missing.length > 0) {
        throw new VerbRefusal(
            'unknown-node',
            `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not a node on ${canvas.id}`,
            nodeLines(canvas, options)
        );
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

const addVerb = defineVerb({
    name: 'node',
    usage: `<${NODE_VERB_KINDS.join('|')}> [--title T] [--text B] [--url U] [--path P] [--source V] [--cwd P] [--view V] [--beside N] [--dry-run]`,
    // The required flags are in the summary too: without them the first thing a first-time caller meets is a refusal.
    summary: `Adds one node to a canvas and prints id, kind, view; ${Object.entries(REQUIRED_FLAG)
        .map(([kind, flag]) => `a ${kind} needs --${flag}`)
        .join(', ')}`,
    detail: NODE_DETAIL,
    dryRun: true,
    positionals: z.tuple([z.enum(NODE_VERB_KINDS, { error: KIND_MESSAGE })], {
        error: (issue) => (issue.code === 'too_big' ? 'node takes one kind and nothing else; a title goes in --title' : KIND_MESSAGE)
    }),
    flags: z.object({
        title: titleField('--title', '--title needs a title').optional(),
        text: z.string().transform(unescapeText).optional(),
        url: z.string().min(1, '--url needs an http or https address').optional(),
        path: z.string().min(1, '--path needs the path of a file').optional(),
        source: z.string().min(1, '--source needs the id of a drawing view').optional(),
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
            const canvas = canvasFor(content, place, flags.view);
            if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, 1);
            }
            let sourceName: string | undefined;
            if (flags.source !== undefined) {
                const source = content.views.find((view) => view.id === flags.source);
                if (!source || !isDrawingView(source)) {
                    throw new VerbRefusal(
                        'not-a-drawing',
                        `${flags.source} is not a drawing view of this project`,
                        orNote(
                            content.views.filter(isDrawingView).map((view) => `drawing\t${view.id}\t${field(view.name)}`),
                            'This project has no drawing views; a person makes one in the sidebar'
                        )
                    );
                }
                sourceName = source.name;
            }
            const size = NODE_SIZE[kind];
            const anchor = flags.beside === undefined ? undefined : canvas.nodes.find((node) => node.id === flags.beside);
            if (flags.beside !== undefined && !anchor) {
                throw new VerbRefusal('unknown-node', `${flags.beside} is not a node on ${canvas.id}`, nodeLines(canvas));
            }
            const rect = anchor ? placeBeside(anchor, size) : placeFree(canvas.nodes, size, canvas.nodes.find((node) => node.id === call.caller) ?? null);
            if (dryRun) {
                return { content: null, result: [`dry-run\t${kind}\t${canvas.id}`] };
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
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, node] } : view)) },
                result: [`${id}\t${kind}\t${canvas.id}`]
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
        return ['detail\truimte-context nodes --view <id>\tthe nodes of a canvas, which is where an id comes from'];
    }
    return nodeLines(canvas, {
        takes: (node) => node.id !== call.caller && (call.anyNode || call.madeBy(node.id) === call.caller),
        empty: `You have no node on ${canvas.id} to remove; node delete takes a node you made yourself`
    });
};

const deleteSub = defineSubVerb('node', {
    name: 'delete',
    usage: '<nodeId>',
    summary: 'Removes a node you made, with the session it holds and the lines that ran into it',
    detail: [
        'argument\t<nodeId>\trequired\tThe node to remove, by id; ruimte-context nodes lists them',
        'prints\tdeleted\tid\tkind\ttitle\tthe node that went',
        'prints\tended\tid\tkind\tthe session it took with it, for a terminal or a chat',
        'prints\tedges\tcount\thow many lines ran into or out of it and went with it',
        'prints\tmembers\tcount\tfor a group: how many nodes stood in the frame and stayed where they are',
        'rule\tOnly a node whose maker is you, which is every node you made with node, agent or team',
        'rule\tA machine can free every node and view of every project on it; a refusal says whether this one does',
        'rule\tNever your own node, since that would end the session asking',
        'group\tRemoving a group takes the frame and nothing else: the nodes inside it stay where they stand, because they are not yours to remove with it',
        'note\tThe node is found on any canvas of this project, so this takes no --view',
        'see\truimte-context nodes\tthe nodes of a canvas, with the ids this takes'
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
                throw new VerbRefusal(
                    'unknown-node',
                    `${id} is not a node on any canvas of this project`,
                    deletableLines(content, place, { caller: call.caller, madeBy: (candidate) => call.host.madeBy(candidate), anyNode })
                );
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

/*
 * One verb with one word after it that is not a kind. `node delete` is not a group of its own
 * because everything else `node` does is `node <kind>`, and a registry entry that dispatches on the
 * first word keeps both shapes on one verb, with the sub rendered by the same `help` as `view`'s.
 */
export const nodeVerb: Verb = {
    ...addVerb,
    usage: `${addVerb.usage} | delete <nodeId>`,
    flagNames: [...new Set([...addVerb.flagNames, ...deleteSub.flagNames])],
    subcommands: [deleteSub],
    run: (argv, call) => (argv[0] === deleteSub.word ? deleteSub.run(argv.slice(1), call) : addVerb.run(argv, call))
};
