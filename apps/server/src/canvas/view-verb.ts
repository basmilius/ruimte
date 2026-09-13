import {
    PROJECT_ICON_EMOJI_MAX,
    PROJECT_ICON_NAMES,
    ProjectViewSchema,
    emptyCanvasView,
    isSeparatorView,
    sessionNodesOfView,
    storedPathOf,
    withMovedView,
    withRenamedView,
    withView,
    withViewIcon,
    withoutView,
    type ProjectContent,
    type ProjectIconChoice,
    type ProjectView,
    type ProjectViewKind
} from '@ruimte/contracts';
import { z } from 'zod';
import type { IndexedPlace } from '../projects/project-index.ts';
import { checkUrl, newId } from './node-verb.ts';
import { checkPath, isInside } from './project-paths.ts';
import { TITLE_LINE, VerbRefusal, defineSubVerb, defineVerbGroup, field, placeOf, titleField } from './verb.ts';

/*
 * A ceiling on the sidebar, not a budget: a project with this many rows is one nobody can read any
 * more, and the number is here to stop an agent in a loop long before that.
 */
export const MAX_PROJECT_VIEWS = 100;

/* Straight from the union in contracts, so a kind added there is one this verb makes on its own. */
export const VIEW_KINDS = ProjectViewSchema.options.map((option) => option.shape.kind.value);

type ViewFlag = 'path' | 'url';

// The flags that only mean something on one kind; every kind takes --after.
const KIND_FLAGS: Partial<Record<ProjectViewKind, ViewFlag>> = { file: 'path', browser: 'url' };

/* The prefix a fresh id gets, the same one the client's own `nextId` uses for that kind: a chat,
   terminal or browser view is a session under its own id, so it carries its kind in the id. */
const ID_PREFIX: Partial<Record<ProjectViewKind, string>> = { chat: 'chat', terminal: 'terminal', browser: 'browser', separator: 'separator' };

const kindsFor = (flag: ViewFlag): string =>
    VIEW_KINDS.filter((kind) => KIND_FLAGS[kind] === flag)
        .map((kind) => `${kind} (required)`)
        .join(', ');

export const viewLines = (content: ProjectContent): string[] => content.views.map((view) => `view\t${view.id}\t${view.kind}\t${field(view.name ?? '')}`);

/*
 * Whether `view delete` would remove this view for this caller: one it made itself, or any view at
 * all on a machine that says so. A view the caller is standing in is never deletable, since the
 * verb would end the session that is asking.
 */
export const deletableView = (view: ProjectView, call: { caller: string; place: IndexedPlace; anyView: boolean }): boolean => {
    if (view.id === call.caller || view.id === call.place.canvasId) {
        return false;
    }
    return call.anyView || view.createdBy === call.caller;
};

/* The icon names in rows of ten: sixty of them one per line would bury the refusal they belong to. */
const ICON_NAME_LINES = Array.from({ length: Math.ceil(PROJECT_ICON_NAMES.length / 10) }, (_, row) =>
    ['icons', ...PROJECT_ICON_NAMES.slice(row * 10, row * 10 + 10)].join('\t')
);

/*
 * A Lucide name from the closed set, or an emoji. A value that reads like a name (letters, digits
 * and dashes) and is not in the set is a typo rather than a mark, so it is refused with the set
 * instead of being written into the file as an emoji nothing can draw.
 */
const iconChoice = (value: string): ProjectIconChoice => {
    if ((PROJECT_ICON_NAMES as readonly string[]).includes(value)) {
        return { kind: 'lucide', value: value as (typeof PROJECT_ICON_NAMES)[number] };
    }
    if (/^[a-zA-Z0-9-]+$/.test(value)) {
        throw new VerbRefusal('unknown-icon', `${value} is not one of the ${PROJECT_ICON_NAMES.length} Lucide names a view picks from`, ICON_NAME_LINES);
    }
    if ([...value].length > PROJECT_ICON_EMOJI_MAX) {
        throw new VerbRefusal('unknown-icon', `That emoji is ${[...value].length} code points and at most ${PROJECT_ICON_EMOJI_MAX} fit in the mark of a view`);
    }
    return { kind: 'emoji', value };
};

/* The view an id names, refused with the list when it names none: the views are a closed set. */
const viewNamed = (content: ProjectContent, id: string, flag: string): ProjectView => {
    const view = content.views.find((candidate) => candidate.id === id);
    if (!view) {
        throw new VerbRefusal('unknown-view', `${id} is not a view of this project`, [...viewLines(content), `note\t${flag} takes a view id, never a name`]);
    }
    return view;
};

const nameArgument = titleField('A view name', 'view new needs a name');

const newSub = defineSubVerb('view', {
    name: 'new',
    usage: `<name> [--kind ${VIEW_KINDS.join('|')}] [--path P] [--url U] [--after V]`,
    summary: `Adds a view to the sidebar and prints id, kind, name; the default kind is ${VIEW_KINDS[0]}`,
    detail: [
        'argument\t<name>\trequired\tWhat the row is called; a name with spaces in it is one argument',
        'prints\tid\tkind\tname\tthe id of the new view, its kind and its name',
        `flag\t--kind K\toptional\t${VIEW_KINDS.join(', ')}; without it a ${VIEW_KINDS[0]}`,
        `flag\t--path P\t${kindsFor('path')}\tThe file the view reads; it has to exist`,
        `flag\t--url U\t${kindsFor('url')}\tAn http or https address`,
        'flag\t--after V\toptional\tPuts the row right under view V; without it the row goes last',
        'kind\tseparator\tA line in the sidebar with a label, which never opens and holds nothing',
        'kind\tchat, terminal\tOpened empty, with no CLI and no directory; the id is the session id',
        'paths\t--path is resolved against the project folder, never against your own directory; it may also be absolute and then points outside',
        `limit\tA project holds at most ${MAX_PROJECT_VIEWS} views`,
        'note\tThe view is written down as yours, which is what lets you remove it again with view delete',
        TITLE_LINE
    ],
    positionals: z.tuple([nameArgument], {
        error: (issue) =>
            issue.code === 'too_big' ? 'view new takes one name and nothing else; a name with spaces in it is one argument' : 'view new needs a name'
    }),
    flags: z.object({
        kind: z.enum(VIEW_KINDS, { error: `--kind takes one of ${VIEW_KINDS.join(', ')}` }).optional(),
        path: z.string().min(1, '--path needs the path of a file').optional(),
        url: z.string().min(1, '--url needs an http or https address').optional(),
        after: z.string().min(1, '--after needs the id of a view').optional()
    }),
    async run({ positionals: [name], flags }, call) {
        const place = placeOf(call);
        const kind = flags.kind ?? VIEW_KINDS[0]!;
        for (const flag of ['path', 'url'] as const) {
            if (flags[flag] !== undefined && KIND_FLAGS[kind] !== flag) {
                throw new VerbRefusal('flag-not-for-kind', `--${flag} does not go with a ${kind} view`, [
                    `kind\t${kind}\t${KIND_FLAGS[kind] === undefined ? 'takes neither --path nor --url' : `--${KIND_FLAGS[kind]} (required)`}`,
                    `flag\t--path\t${kindsFor('path')}`,
                    `flag\t--url\t${kindsFor('url')}`
                ]);
            }
        }
        const required = KIND_FLAGS[kind];
        if (required && flags[required] === undefined) {
            throw new VerbRefusal('missing-flag', `A ${kind} view needs --${required}`, [`kind\t${kind}\t--${required} (required)`]);
        }

        // The disk is read before the lock, so a slow folder holds up nobody else's save.
        const url = flags.url === undefined ? undefined : checkUrl(flags.url);
        const path = flags.path === undefined ? undefined : await checkPath(place.folder, flags.path);

        return call.host.mutate(place.projectId, (content) => {
            if (content.views.length + 1 > MAX_PROJECT_VIEWS) {
                throw new VerbRefusal('too-many-views', `This project has ${content.views.length} views and a project holds at most ${MAX_PROJECT_VIEWS}`);
            }
            if (flags.after !== undefined) {
                viewNamed(content, flags.after, '--after');
            }
            const id = newId(ID_PREFIX[kind] ?? 'view', content);
            const view = madeView(kind, id, name, call.caller, { url, path: path === undefined ? undefined : storedFilePath(place.folder, path) });
            return {
                content: { ...content, views: withView(content.views, view, flags.after) },
                result: [`${id}\t${kind}\t${field(name)}`]
            };
        });
    }
});

/* A path stays inside the project folder as a stored one, and stays absolute when it points out. */
const storedFilePath = (folder: string | null, path: string): string => (folder !== null && isInside(folder, path) ? storedPathOf(folder, path) : path);

const madeView = (kind: ProjectViewKind, id: string, name: string, createdBy: string, parts: { url?: string; path?: string }): ProjectView => {
    if (kind === 'canvas') {
        return { ...emptyCanvasView(id, name), createdBy };
    }
    if (kind === 'separator') {
        return { kind, id, name, createdBy };
    }
    if (kind === 'chat' || kind === 'terminal') {
        return { kind, id, name, node: {}, createdBy };
    }
    if (kind === 'browser') {
        return { kind, id, name, url: parts.url!, createdBy };
    }
    if (kind === 'file') {
        return { kind, id, name, path: parts.path!, createdBy };
    }
    return { kind, id, name, createdBy };
};

const renameSub = defineSubVerb('view', {
    name: 'rename',
    usage: '<viewId> <name>',
    summary: 'Renames a view and prints id, kind, name; nothing the view hosts renames over it again',
    detail: [
        'argument\t<viewId>\trequired\tThe view to rename, by id; ruimte-context views lists them',
        'argument\t<name>\trequired\tThe new name, one argument, spaces and all',
        'prints\tid\tkind\tname\tthe view as it now stands',
        'note\tA name set here is the view name for good: a page or a session never renames over it',
        TITLE_LINE
    ],
    positionals: z.tuple([z.string().min(1, 'view rename needs the id of a view'), nameArgument], {
        error: (issue) => (issue.code === 'too_big' ? 'view rename takes a view id and one name' : 'view rename needs the id of a view and a name')
    }),
    flags: z.object({}),
    async run({ positionals: [id, name] }, call) {
        const place = placeOf(call);
        return call.host.mutate(place.projectId, (content) => {
            const view = viewNamed(content, id, 'view rename');
            const views = withRenamedView(content.views, id, name);
            // A rename to the name it already carries is what the caller asked for, so it is not a refusal.
            return { content: views === null ? null : { ...content, views }, result: [`${id}\t${view.kind}\t${field(name)}`] };
        });
    }
});

const iconSub = defineSubVerb('view', {
    name: 'icon',
    usage: '<viewId> <lucide-name|emoji>',
    summary: 'Gives a view a mark of its own and prints id, kind, icon kind, icon',
    detail: [
        'argument\t<viewId>\trequired\tThe view to mark, by id; ruimte-context views lists them',
        'argument\t<mark>\trequired\tA Lucide name from the set the picker has, or an emoji',
        'prints\tid\tkind\tlucide|emoji\tthe mark the view now wears',
        `names\t${PROJECT_ICON_NAMES.length} Lucide names; a refusal prints all of them`,
        `emoji\tAt most ${PROJECT_ICON_EMOJI_MAX} code points`,
        'note\tA separator is a line in the sidebar and has no room for a mark'
    ],
    positionals: z.tuple([z.string().min(1, 'view icon needs the id of a view'), z.string().min(1, 'view icon needs a Lucide name or an emoji')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'view icon takes a view id and one mark' : 'view icon needs the id of a view and a Lucide name or an emoji'
    }),
    flags: z.object({}),
    async run({ positionals: [id, value] }, call) {
        const place = placeOf(call);
        const icon = iconChoice(value);
        return call.host.mutate(place.projectId, (content) => {
            const view = viewNamed(content, id, 'view icon');
            if (isSeparatorView(view)) {
                throw new VerbRefusal('not-markable', `${id} is a separator, a line in the sidebar with no room for a mark`);
            }
            const views = withViewIcon(content.views, id, icon);
            return { content: views === null ? null : { ...content, views }, result: [`${id}\t${view.kind}\t${icon.kind}\t${field(icon.value)}`] };
        });
    }
});

const moveSub = defineSubVerb('view', {
    name: 'move',
    usage: '<viewId> --after V | --first',
    summary: 'Moves a view to another place in the sidebar and prints id, kind, the place it now has',
    detail: [
        'argument\t<viewId>\trequired\tThe view to move, by id; ruimte-context views lists them',
        'flag\t--after V\tone of two\tPuts the row right under view V',
        'flag\t--first\tno value\tPuts the row at the top of the list',
        'prints\tid\tkind\tindex\tthe place it now has, counted from 0 over every row, separators included',
        'note\tExactly one of --after and --first; the order of the list is the order of the file'
    ],
    positionals: z.tuple([z.string().min(1, 'view move needs the id of a view')], {
        error: (issue) => (issue.code === 'too_big' ? 'view move takes one view id; where it goes is a flag' : 'view move needs the id of a view')
    }),
    flags: z.object({ after: z.string().min(1, '--after needs the id of a view').optional() }),
    switches: ['first'],
    async run({ positionals: [id], flags, switches }, call) {
        const place = placeOf(call);
        const first = switches.has('first');
        if (first === (flags.after !== undefined)) {
            throw new VerbRefusal('two-places', 'view move takes exactly one of --after and --first', [
                'flag\t--after V\tright under view V',
                'flag\t--first\tat the top of the list'
            ]);
        }
        return call.host.mutate(place.projectId, (content) => {
            const view = viewNamed(content, id, 'view move');
            let toIndex = 0;
            if (!first) {
                const after = viewNamed(content, flags.after!, '--after');
                if (after.id === id) {
                    throw new VerbRefusal('two-places', 'view move cannot put a view under itself');
                }
                // The index is read off the list without the view, since that is where it is put back.
                toIndex = content.views.filter((candidate) => candidate.id !== id).findIndex((candidate) => candidate.id === after.id) + 1;
            }
            const views = withMovedView(content.views, id, toIndex);
            return {
                content: views === null ? null : { ...content, views },
                result: [`${id}\t${view.kind}\t${(views ?? content.views).findIndex((candidate) => candidate.id === id)}`]
            };
        });
    }
});

const deleteSub = defineSubVerb('view', {
    name: 'delete',
    usage: '<viewId>',
    summary: 'Removes a view you made, with the sessions it holds, and prints what went',
    detail: [
        'argument\t<viewId>\trequired\tThe view to remove, by id; ruimte-context views lists them',
        'prints\tdeleted\tid\tkind\tname\tthe view that went',
        'prints\tended\tid\tkind\tone line per session it took with it, a terminal or a chat',
        'rule\tOnly a view whose maker is you, which is every view you made with view new',
        'rule\tA machine can free every view of every project on it; a refusal says whether this one does',
        'rule\tNever the view you are standing in, since that would end the session asking, which is also why this can never empty the sidebar',
        'note\tA canvas takes its nodes with it, so the shells and agents on it stop where they are',
        'see\truimte-context views\tthe last column says which views this rule lets you remove'
    ],
    positionals: z.tuple([z.string().min(1, 'view delete needs the id of a view')], {
        error: (issue) => (issue.code === 'too_big' ? 'view delete takes one view id and nothing else' : 'view delete needs the id of a view')
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const place = placeOf(call);
        const anyView = call.host.agentsDeleteAnyView();
        return call.host.mutate(place.projectId, async (content) => {
            const view = viewNamed(content, id, 'view delete');
            refuseUndeletable(view, { caller: call.caller, place, anyView });
            const result = withoutView(content.views, id)!;
            const sessions = sessionNodesOfView(view);
            /* The sessions go before the write, the rule a project closing follows: a shell that
               outlived the canvas it stood on would answer to a node nothing draws any more. */
            for (const node of sessions) {
                await call.host.endSession(node.kind, node.id);
            }
            return {
                content: { ...content, views: result.views },
                result: [`deleted\t${id}\t${view.kind}\t${field(view.name ?? '')}`, ...sessions.map((node) => `ended\t${node.id}\t${node.kind}`)]
            };
        });
    }
});

/* Why this view stays. Every sentence names the way out, since the caller cannot read the machine. */
const refuseUndeletable = (view: ProjectView, call: { caller: string; place: IndexedPlace; anyView: boolean }): void => {
    if (deletableView(view, call)) {
        return;
    }
    if (view.id === call.caller || view.id === call.place.canvasId) {
        throw new VerbRefusal('deletes-caller', `You are in ${view.id}, so removing it would end the session asking`);
    }
    throw new VerbRefusal('not-yours', `${view.id} was made by ${view.createdBy ?? 'a person'} and view delete only removes a view you made yourself`, [
        `made by\t${view.createdBy ?? 'a person'}`,
        `you\t${call.caller}`,
        "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every view; a person turns it on from the Machines pane"
    ]);
};

export const viewVerb = defineVerbGroup({
    name: 'view',
    summary: 'Manages the views of the project: makes one, renames it, marks it, moves it, removes it',
    detail: [
        'see\truimte-context views\tthe views of the project, which is where every id here comes from',
        'note\tA view is a row in the sidebar: a canvas, a drawing, a file, a page, a session of its own, or a line between them',
        'note\tThe views of a project are shared, so what you make here is what every person with this project open sees'
    ],
    subs: [newSub, renameSub, iconSub, moveSub, deleteSub]
});
