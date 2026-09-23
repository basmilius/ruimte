import { DEFAULT_TITLES, NODE_ACCENT_NAMES } from '@ruimte/contracts';
import { z } from 'zod';
import { COLOR_LINES } from '../actions/node-actions.ts';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { MAX_CANVAS_NODES, idList } from './nodes.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, field, placeOf, requiredField, titleField } from './verb.ts';

export const groupAction = defineActionVerb('node', {
    name: 'group',
    action: 'group.create',
    usage: '--nodes A,B [--label L] [--color C] [--view V]',
    params: [
        { syntax: '--nodes A,B', need: 'required', field: 'nodeIds', text: 'The nodes the frame goes around, by id, separated by commas' },
        {
            syntax: '--label L',
            need: 'optional',
            field: 'label',
            more: `at most ${MAX_TITLE_LENGTH} characters; without one it is called "${DEFAULT_TITLES.group}"`
        },
        { syntax: '--color C', need: 'optional', field: 'color', more: `one of ${NODE_ACCENT_NAMES.length}` },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the nodes are on, by view id', more: 'ruimte-context view list lists them' }
    ],
    detail: [
        ...COLOR_LINES,
        'prints\tid\tgroup\tlabel\tview\tmembers\tthe new group, its label, the canvas it landed on, and how many nodes stand inside the frame',
        'prints\talso\tid\tkind\ttitle\tone line per node you did not name that the frame ended up around',
        'prints\tedges\tcount\tid\tthe lines of your own that went with the frame and the id of the one line into the group that came instead; the row is there only when a line went',
        'where\tThe frame is the box your nodes already occupy, with room on every side and a title band above it, snapped to the canvas grid, which is where a person grouping a selection would have put it',
        'members\tA group holds whatever has its center inside it, so a node standing between the ones you named goes in with them; that is what the also rows are for',
        'lines\tThe frame takes your own lines into what it now holds along with it: a line into a group makes everything inside it readable at once, each under its own title, so a line per node says nothing more',
        'lines\tOne line is drawn back, from you into the group, the same line node new draws into what it makes; nothing is drawn where nothing went, so a frame you had no line into is left without one',
        'lines\tOnly a line whose ends are both yours, the rule link delete follows: a line a person drew stays, because that is the context that person gave you',
        'lines\tEither way round counts, since a line between you and a node that is not an agent reads the same in both directions',
        'rule\tEvery node has to stand in the same place already: all of them on the canvas itself, or all of them inside one and the same group',
        'rule\tA group is never one of --nodes; a frame is drawn around nodes, and the client leaves a group out of a selection for the same reason',
        'collapsed\tInside a group that is folded shut the new frame joins its members in the file, so it is folded away with the rest',
        `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes, this frame among them`,
        'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
        'see\truimte-context node arrange\ttidying those nodes before you draw a frame around them',
        TITLE_LINE
    ],
    positionals: z.tuple([], { error: 'node group takes no arguments, only flags; the nodes go in --nodes' }),
    flags: z.object({
        nodes: requiredField('--nodes needs one or more node ids, separated by commas'),
        label: titleField('--label', '--label needs a name for the group').optional(),
        color: z.string().min(1, '--color needs a color').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ flags }, call) {
        const nodeIds = idList(flags.nodes, '--nodes');
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const grouped = await runAction(call, 'group.create', { viewId, nodeIds, label: flags.label ?? null, color: flags.color ?? null });
        return [
            [grouped.groupId, 'group', field(grouped.label ?? ''), grouped.viewId, String(grouped.members.length)].join('\t'),
            ...(grouped.also ?? []).map((node) => ['also', node.nodeId, node.kind, field(node.title)].join('\t')),
            ...(grouped.edges ? [['edges', String(grouped.edges.replaced), grouped.edges.edgeId].join('\t')] : [])
        ];
    }
});
