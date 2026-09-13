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
import { placeBeside, placeFree } from './placement.ts';
import { checkCwd, checkPath, isInside } from './project-paths.ts';
import { unescapeText } from './text-escapes.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, VerbRefusal, canvasFor, defineVerb, field, orNote, placeOf, titleField } from './verb.ts';

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

export const nodeLines = (canvas: ProjectCanvasView): string[] => {
    if (canvas.nodes.length > BESIDE_LINES_MAX) {
        return [`detail\truimte-context nodes\tthe ${canvas.nodes.length} nodes of ${canvas.id}`];
    }
    return orNote(
        canvas.nodes.map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
        `${canvas.id} has no nodes on it yet`
    );
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

const checkUrl = (url: string): string => {
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

export const nodeVerb = defineVerb({
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

        return call.host.mutate(place.projectId, (content) => {
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
