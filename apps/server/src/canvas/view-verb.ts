import { PROJECT_ICON_NAMES } from '@ruimte/contracts';
import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { REVISION_ROW, TITLE_LINE, VerbRefusal, field, titleField, type Action } from './verb.ts';
import { MAX_PROJECT_VIEWS, VIEW_KINDS, viewKindsFor } from './views.ts';

export { MAX_PROJECT_VIEWS, VIEW_KINDS } from './views.ts';

// A canvas with more nodes than this would bury the one line that says the view is gone.
const DELETED_NODE_LINES = 20;

const LISTED = 'ruimte-context view list lists them';

const nameArgument = titleField('A view name', 'view new needs a name');

const newSub = defineActionVerb('view', {
    name: 'new',
    action: 'view.create',
    usage: `<name> [--kind ${VIEW_KINDS.join('|')}] [--path P] [--url U] [--after V]`,
    note: `The default kind is ${VIEW_KINDS[0]}.`,
    params: [
        { syntax: '<name>', need: 'required', field: 'name', text: 'What the row is called; a name with spaces in it is one argument' },
        { syntax: '--kind K', need: 'optional', field: 'kind', text: `${VIEW_KINDS.join(', ')}; without it a ${VIEW_KINDS[0]}` },
        { syntax: '--path P', need: viewKindsFor('path'), field: 'path', more: 'it has to exist' },
        { syntax: '--url U', need: viewKindsFor('url'), field: 'url' },
        { syntax: '--after V', need: 'optional', field: 'after' }
    ],
    detail: [
        'prints\tid\tkind\tname\tthe id of the new view, its kind and its name',
        'kind\tseparator\tA line in the sidebar with a label, which never opens and holds nothing',
        'kind\tsubheader\tA heading over the rows under it, which never opens and holds nothing',
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
        const made = await runAction(call, 'view.create', {
            kind: flags.kind ?? VIEW_KINDS[0]!,
            name,
            url: flags.url ?? null,
            command: null,
            path: flags.path ?? null,
            provider: null,
            after: flags.after ?? null
        });
        return [`${made.viewId}\t${made.kind}\t${field(made.view)}`];
    }
});

const renameSub = defineActionVerb('view', {
    name: 'rename',
    action: 'view.rename',
    usage: '<viewId> <name>',
    params: [
        { syntax: '<viewId>', need: 'required', field: 'viewId', text: 'The view to rename, by id', more: LISTED },
        { syntax: '<name>', need: 'required', field: 'name', text: 'The new name, one argument, spaces and all' }
    ],
    detail: [
        'prints\tid\tkind\tname\tthe view as it now stands',
        'note\tA name set here is the view name for good: a page or a session never renames over it',
        TITLE_LINE
    ],
    positionals: z.tuple([z.string().min(1, 'view rename needs the id of a view'), nameArgument], {
        error: (issue) => (issue.code === 'too_big' ? 'view rename takes a view id and one name' : 'view rename needs the id of a view and a name')
    }),
    flags: z.object({}),
    async run({ positionals: [id, name] }, call) {
        const renamed = await runAction(call, 'view.rename', { viewId: id, name });
        return [`${id}\t${renamed.kind}\t${field(renamed.name)}`];
    }
});

const iconSub = defineActionVerb('view', {
    name: 'icon',
    action: 'view.setIcon',
    usage: '<viewId> <lucide-name>',
    params: [
        { syntax: '<viewId>', need: 'required', field: 'viewId', text: 'The view to mark, by id', more: LISTED },
        { syntax: '<mark>', need: 'required', field: 'icon' }
    ],
    detail: [
        'prints\tid\tkind\tlucide\tthe mark the view now wears',
        `names\t${PROJECT_ICON_NAMES.length} Lucide names; a refusal prints all of them`,
        'note\tA separator and a subheader divide the sidebar and have no room for a mark'
    ],
    positionals: z.tuple([z.string().min(1, 'view icon needs the id of a view'), z.string().min(1, 'view icon needs a Lucide name')], {
        error: (issue) => (issue.code === 'too_big' ? 'view icon takes a view id and one mark' : 'view icon needs the id of a view and a Lucide name')
    }),
    flags: z.object({}),
    async run({ positionals: [id, value] }, call) {
        const marked = await runAction(call, 'view.setIcon', { viewId: id, icon: value });
        return [`${id}\t${marked.kind}\tlucide\t${field(marked.icon?.value ?? value)}`];
    }
});

const moveSub = defineActionVerb('view', {
    name: 'move',
    action: 'view.move',
    usage: '<viewId> --after V | --first',
    params: [
        { syntax: '<viewId>', need: 'required', field: 'viewId', text: 'The view to move, by id', more: LISTED },
        { syntax: '--after V', need: 'one of two', field: 'afterViewId', text: 'Puts the row right under view V' },
        { syntax: '--first', need: 'no value', text: 'Puts the row at the top of the list' }
    ],
    detail: [
        'prints\tid\tkind\tindex\tthe place it now has, counted from 0 over every row, separators included',
        'note\tExactly one of --after and --first; the order of the list is the order of the file'
    ],
    positionals: z.tuple([z.string().min(1, 'view move needs the id of a view')], {
        error: (issue) => (issue.code === 'too_big' ? 'view move takes one view id; where it goes is a flag' : 'view move needs the id of a view')
    }),
    flags: z.object({ after: z.string().min(1, '--after needs the id of a view').optional() }),
    switches: ['first'],
    async run({ positionals: [id], flags, switches }, call) {
        if (switches.has('first') === (flags.after !== undefined)) {
            throw new VerbRefusal('two-places', 'view move takes exactly one of --after and --first', [
                'flag\t--after V\tright under view V',
                'flag\t--first\tat the top of the list'
            ]);
        }
        const moved = await runAction(call, 'view.move', { viewId: id, afterViewId: flags.after ?? null });
        return [`${id}\t${moved.kind}\t${moved.index}`];
    }
});

const deleteSub = defineActionVerb('view', {
    name: 'delete',
    action: 'view.delete',
    usage: '<viewId>',
    params: [{ syntax: '<viewId>', need: 'required', field: 'viewId', text: 'The view to remove, by id', more: LISTED }],
    detail: [
        'prints\tdeleted\tid\tkind\tname\tthe view that went',
        'prints\tended\tid\tkind\tone line per session it took with it, a terminal or a chat',
        `prints\tnode\tid\tkind\ttitle\tone line per node that stood on it, up to ${DELETED_NODE_LINES}, with a nodes row counting them all`,
        'rule\tOnly a view whose maker is you, which is every view you made with view new',
        'rule\tA machine can free every view of every project on it; a refusal says whether this one does',
        'rule\tNever the view you are standing in, since that would end the session asking, which is also why this can never empty the sidebar',
        'note\tA canvas takes its nodes with it, so the shells and agents on it stop where they are',
        'see\truimte-context view list\tthe last column says which views this rule lets you remove'
    ],
    positionals: z.tuple([z.string().min(1, 'view delete needs the id of a view')], {
        error: (issue) => (issue.code === 'too_big' ? 'view delete takes one view id and nothing else' : 'view delete needs the id of a view')
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const deleted = await runAction(call, 'view.delete', { viewId: id });
        const nodes = deleted.nodes ?? [];
        return [
            `deleted\t${id}\t${deleted.kind}\t${field(deleted.view)}`,
            ...(deleted.ended ?? []).map((node) => `ended\t${node.nodeId}\t${node.kind}`),
            /* What a canvas took with it, counted and then named: a `deleted` line on its own leaves a
               caller guessing whether the note it made is still somewhere. */
            ...(nodes.length === 0
                ? []
                : [`nodes\t${nodes.length}`, ...nodes.slice(0, DELETED_NODE_LINES).map((node) => `node\t${node.nodeId}\t${node.kind}\t${field(node.title)}`)])
        ];
    }
});

const listSub = defineActionVerb('view', {
    name: 'list',
    action: 'view.list',
    usage: '',
    params: [],
    detail: [
        'prints\tid\tkind\tname\tdelete\twhy\tone line per view, in the order the sidebar has them',
        `kinds\t${VIEW_KINDS.join('\t')}`,
        'delete\tyes or no: whether ruimte-context view delete would remove that view for you, with the reason beside it',
        'why\tyours, this machine frees every view, a person made it, <id> made it, or you are in it',
        'self\tThe row after the views is self and the id of the view you are in',
        REVISION_ROW,
        'note\tA separator is a line in the sidebar and has an empty name',
        'see\truimte-context help view\tmaking a view, renaming it, marking it, moving it, removing it'
    ],
    positionals: z.tuple([], { error: 'view list takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const { views, self, revision } = await runAction(call, 'view.list', {});
        return [
            ...views.map((view) => `${view.viewId}\t${view.kind}\t${field(view.name)}\t${view.deletable ? 'yes' : 'no'}\t${view.why}`),
            `self\t${self}`,
            `revision\t${revision}`
        ];
    }
});

/* Without `view open` and `view diagram`, which have files of their own; the registry puts them after these. */
export const VIEW_ACTIONS: readonly Action[] = [listSub, newSub, renameSub, iconSub, moveSub, deleteSub];

export const VIEW_SUMMARY = 'Lists, makes, renames, marks, moves, removes and shows the views of the project, and writes a diagram';

export const VIEW_DETAIL: readonly string[] = [
    'see\truimte-context view list\tthe views of the project, which is where every id here comes from',
    'note\tA view is a row in the sidebar: a canvas, a drawing, a diagram, a file, a page, a session of its own, or a line between them',
    'note\tThe views of a project are shared, so what you make here is what every person with this project open sees'
];
