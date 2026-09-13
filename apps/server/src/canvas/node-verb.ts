import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { DEFAULT_TITLES, NODE_SIZE, isCanvasView, isDrawingView, storedPathOf, type ProjectContent, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { placeBeside, placeFree } from './placement.ts';
import { VerbRefusal, canvasFor, defineVerb, field, placeOf } from './verb.ts';

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

const isInside = (root: string, path: string): boolean => {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const realOrNull = (path: string): Promise<string | null> => realpath(path).catch(() => null);

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

// The shape the client's `nextId` gives: the kind, a dash, eight base-36 characters.
const newNodeId = (kind: NodeVerbKind, taken: Set<string>): string => {
    for (;;) {
        const id = `${kind}-${Array.from(randomBytes(8), (byte) => (byte % 36).toString(36)).join('')}`;
        if (!taken.has(id)) {
            return id;
        }
    }
};

/*
 * A cwd lies in the project folder or in a worktree of its repository: an agent must not hand a new
 * session a folder outside the project the person opened it in. Compared on real paths, so neither a
 * symlink inside the folder nor `/tmp` against `/private/tmp` decides it.
 */
const checkCwd = async (folder: string | null, cwd: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> => {
    if (folder === null) {
        throw new VerbRefusal('no-folder', 'This project has no folder, so --cwd has nothing to be inside of');
    }
    const resolved = resolve(folder, cwd);
    const real = await realOrNull(resolved);
    if (real === null || !(await stat(real)).isDirectory()) {
        throw new VerbRefusal('bad-cwd', `${resolved} is not a folder`);
    }
    const realFolder = await realOrNull(folder);
    if (realFolder !== null && isInside(realFolder, real)) {
        return resolved;
    }
    const worktrees = await Promise.all((await worktreePaths(folder)).map(realOrNull));
    if (!worktrees.some((root) => root !== null && isInside(root, real))) {
        throw new VerbRefusal('cwd-outside-project', `${resolved} is outside the project folder and its worktrees`);
    }
    return resolved;
};

const checkPath = async (folder: string | null, path: string): Promise<string> => {
    if (folder === null && !isAbsolute(path)) {
        throw new VerbRefusal('bad-path', 'This project has no folder, so --path has to be absolute');
    }
    const resolved = folder === null ? path : resolve(folder, path);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) {
        throw new VerbRefusal('bad-path', `${resolved} is not a file`);
    }
    return resolved;
};

const checkUrl = (url: string): string => {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new VerbRefusal('bad-url', `${url} is not a URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new VerbRefusal('bad-url', `${url} is not an http or https address`);
    }
    return parsed.href;
};

export const nodeVerb = defineVerb({
    name: 'node',
    usage: `<${NODE_VERB_KINDS.join('|')}> [--title T] [--text B] [--url U] [--path P] [--source V] [--cwd P] [--view V] [--beside N]`,
    summary: 'Adds one node to a canvas and prints its id; a terminal or chat starts when a client shows it',
    positionals: z.tuple([z.enum(NODE_VERB_KINDS)]),
    flags: z.object({
        title: z.string().trim().min(1).optional(),
        text: z.string().optional(),
        url: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
        source: z.string().min(1).optional(),
        cwd: z.string().min(1).optional(),
        view: z.string().min(1).optional(),
        beside: z.string().min(1).optional()
    }),
    async run({ positionals: [kind], flags }, call) {
        const place = placeOf(call);
        for (const flag of ['text', 'url', 'path', 'source', 'cwd'] as const) {
            if (flags[flag] !== undefined && !KIND_FLAGS[kind].includes(flag)) {
                throw new VerbRefusal('flag-not-for-kind', `--${flag} does not go with a ${kind} node`);
            }
        }
        const required = REQUIRED_FLAG[kind];
        if (required && flags[required] === undefined) {
            throw new VerbRefusal('missing-flag', `A ${kind} node needs --${required}`);
        }

        // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
        const url = flags.url === undefined ? undefined : checkUrl(flags.url);
        const path = flags.path === undefined ? undefined : await checkPath(place.folder, flags.path);
        const cwd = flags.cwd === undefined ? undefined : await checkCwd(place.folder, flags.cwd, (folder) => call.host.worktreePaths(folder));

        return call.host.mutate(place.projectId, (content) => {
            const canvas = canvasFor(content, place, flags.view);
            if (canvas.nodes.length >= MAX_CANVAS_NODES) {
                throw new VerbRefusal('canvas-full', `${canvas.name} already holds ${MAX_CANVAS_NODES} nodes`);
            }
            let sourceName: string | undefined;
            if (flags.source !== undefined) {
                const source = content.views.find((view) => view.id === flags.source);
                if (!source || !isDrawingView(source)) {
                    throw new VerbRefusal(
                        'not-a-drawing',
                        `${flags.source} is not a drawing view of this project`,
                        content.views.filter(isDrawingView).map((view) => `drawing\t${view.id}\t${field(view.name)}`)
                    );
                }
                sourceName = source.name;
            }
            const size = NODE_SIZE[kind];
            const anchor = flags.beside === undefined ? undefined : canvas.nodes.find((node) => node.id === flags.beside);
            if (flags.beside !== undefined && !anchor) {
                throw new VerbRefusal('unknown-node', `${flags.beside} is not a node on ${canvas.id}`);
            }
            const rect = anchor ? placeBeside(anchor, size) : placeFree(canvas.nodes, size, canvas.nodes.find((node) => node.id === call.caller) ?? null);

            const id = newNodeId(kind, idsIn(content));
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
