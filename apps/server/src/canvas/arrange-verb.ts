import type { ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { NOT_A_GROUP, idList, nodesNamed } from './node-verb.ts';
import { ARRANGE_LAYOUTS, PLACEMENT_GAP, arrangeRects, gridColumns, type ArrangeLayout } from './placement.ts';
import { VerbRefusal, canvasFor, defineAction, placeOf, requiredField } from './verb.ts';

const DEFAULT_LAYOUT: ArrangeLayout = 'grid';

const ARRANGE_DETAIL: readonly string[] = [
    'flag\t--nodes A,B\trequired\tThe nodes to tidy, by id, separated by commas; they are laid out in the order you name them',
    `flag\t--layout L\toptional\t${ARRANGE_LAYOUTS.join(', ')}; without it a ${DEFAULT_LAYOUT}`,
    'flag\t--cols N\tgrid only\tHow many columns the grid gets; without it as square as the count allows, so 5 nodes are 3 and 2',
    'flag\t--view V\toptional\tThe canvas the nodes are on, by view id; ruimte-context view list lists them',
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
];

export const arrangeAction = defineAction('node', {
    name: 'arrange',
    usage: `--nodes A,B [--layout ${ARRANGE_LAYOUTS.join('|')}] [--cols N] [--view V]`,
    summary: 'Lays nodes out in a grid, a row or a column without overlap and prints id, x, y',
    detail: ARRANGE_DETAIL,
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
        const place = placeOf(call);
        const layout = flags.layout ?? DEFAULT_LAYOUT;
        if (flags.cols !== undefined && layout !== 'grid') {
            throw new VerbRefusal('flag-not-for-layout', `--cols does not go with ${layout}; a row is one row and a column is one column`, [
                'layout\tgrid\ttakes --cols',
                `layout\t${ARRANGE_LAYOUTS.filter((candidate) => candidate !== 'grid').join(', ')}\ttake no --cols`
            ]);
        }
        const ids = idList(flags.nodes, '--nodes');

        return call.host.mutate(place.projectId, (content) => {
            const canvas = canvasFor(content, place, flags.view);
            const moving = nodesNamed(canvas, ids, NOT_A_GROUP);
            const carrier = moving.find((node) => node.kind === 'group');
            if (carrier) {
                throw new VerbRefusal(
                    'not-arrangeable',
                    `${carrier.id} is a group and carries whatever stands inside it; node arrange moves the nodes it is given, so name those instead`
                );
            }
            if (flags.cols !== undefined && flags.cols > moving.length) {
                throw new VerbRefusal(
                    'too-many-columns',
                    `--cols is ${flags.cols} and you named ${moving.length} ${moving.length === 1 ? 'node' : 'nodes'}; a grid holds at most one column per node`,
                    [`columns\twithout --cols\t${gridColumns(moving.length)}`]
                );
            }

            const placed = arrangeRects(moving, layout, flags.cols);
            const byId = new Map(moving.map((node, index) => [node.id, placed[index]!]));
            const lines = moving.map((node) => [node.id, String(byId.get(node.id)!.x), String(byId.get(node.id)!.y)].join('\t'));
            if (moving.every((node, index) => node.x === placed[index]!.x && node.y === placed[index]!.y)) {
                return { content: null, result: lines };
            }
            const moved = (node: ProjectNode): ProjectNode => {
                const rect = byId.get(node.id);
                return rect === undefined ? node : { ...node, x: rect.x, y: rect.y };
            };
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, nodes: canvas.nodes.map(moved) } : view)) },
                result: lines
            };
        });
    }
});
