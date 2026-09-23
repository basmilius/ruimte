import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { idList } from './nodes.ts';
import { ARRANGE_LAYOUTS, PLACEMENT_GAP, type ArrangeLayout } from './placement.ts';
import { placeOf, requiredField } from './verb.ts';

const DEFAULT_LAYOUT: ArrangeLayout = 'grid';

export const arrangeAction = defineActionVerb('node', {
    name: 'arrange',
    action: 'node.arrange',
    usage: `--nodes A,B [--layout ${ARRANGE_LAYOUTS.join('|')}] [--cols N] [--view V]`,
    params: [
        {
            syntax: '--nodes A,B',
            need: 'required',
            field: 'nodeIds',
            text: 'The nodes to tidy, by id, separated by commas; they are laid out in the order you name them'
        },
        { syntax: '--layout L', need: 'optional', field: 'layout', text: `${ARRANGE_LAYOUTS.join(', ')}; without it a ${DEFAULT_LAYOUT}` },
        { syntax: '--cols N', need: 'grid only', field: 'columns' },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the nodes are on, by view id', more: 'ruimte-context view list lists them' }
    ],
    detail: [
        'prints\tid\tx\ty\tone line per node in the order you named them, at the top left corner it now has',
        'where\tThe block starts at the top left corner of the box those nodes already occupy, so a canvas is straightened where it stands and nothing jumps out of sight; one node therefore never moves',
        `spacing\t${PLACEMENT_GAP} px between them, the same room a new node keeps; a column is as wide as the widest node in it and a row as tall as the tallest, so nodes of different sizes never touch`,
        'sizes\tNothing is resized; this moves nodes and nothing else',
        'layout\trow\tOne row, left to right, top edges level',
        'layout\tcolumn\tOne column, top to bottom, left edges level',
        'layout\tgrid\tRows of --cols, filled left to right; --cols 1 is a column and --cols as many as you named is a row',
        'rule\tA group is never one of --nodes: a frame carries whatever stands in it, and this verb moves the nodes it is given and nothing else',
        'note\tOnly the nodes you name are kept apart; one you leave out may end up under one you named',
        'note\tA node moved out of a frame it stood in leaves that group, the same as a person dragging it out',
        'note\tNodes that are already where this would put them are reported and nothing is written',
        'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs and their sizes'
    ],
    positionals: z.tuple([], { error: 'node arrange takes no arguments, only flags; the nodes go in --nodes' }),
    flags: z.object({
        nodes: requiredField('--nodes needs one or more node ids, separated by commas'),
        layout: z.enum(ARRANGE_LAYOUTS, { error: `--layout takes one of ${ARRANGE_LAYOUTS.join(', ')}` }).optional(),
        cols: z
            .string()
            .regex(/^[1-9][0-9]*$/, '--cols needs a whole number of columns, 1 or more')
            .transform(Number)
            .optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ flags }, call) {
        const layout = flags.layout ?? DEFAULT_LAYOUT;
        const nodeIds = idList(flags.nodes, '--nodes');
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const arranged = await runAction(call, 'node.arrange', { viewId, nodeIds, layout, columns: flags.cols ?? null });
        return arranged.nodes.map((node) => [node.nodeId, String(node.x), String(node.y)].join('\t'));
    }
});
