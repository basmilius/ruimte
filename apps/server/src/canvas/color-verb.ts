import { NODE_ACCENT_NAMES, isNodeAccent } from '@ruimte/contracts';
import { z } from 'zod';
import { COLOR_LINES } from '../actions/node-actions.ts';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { DRY_RUN_PREVIEW, VerbRefusal, placeOf } from './verb.ts';

const NONE = 'none';

export const nodeColorAction = defineActionVerb('node', {
    name: 'color',
    action: 'node.setColor',
    usage: `<nodeId> --color <C|${NONE}> [--view V] [--dry-run]`,
    dryRun: true,
    params: [
        { syntax: '<nodeId>', need: 'required', field: 'nodeId', text: 'The node to color, by id; one node per call' },
        { syntax: `--color <C|${NONE}>`, need: 'required', field: 'color', text: `One of the ${NODE_ACCENT_NAMES.length} colors, or ${NONE} to take it off` },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the node is on, by view id', more: 'ruimte-context view list lists them' },
        { syntax: '--dry-run', need: 'no value', text: `Checks everything and writes nothing; ${DRY_RUN_PREVIEW}` }
    ],
    detail: [
        ...COLOR_LINES,
        'prints\tcolored\tid\tkind\tcolor\tthe node and the color it now has, - for none',
        'note\tA note takes its paper from the color; any other node shows it on its frame and header',
        'note\tA note from before Color covered notes loses its old paper with every color you give it, none too, so it shows what you picked',
        'note\tThe color it already has writes nothing and is not a refusal',
        'who\tYour own node, a node you made yourself, or one a line joins you to, whichever way that line runs, the rule node edit follows',
        'who\tA chat view has no lines: it colors any node of the canvas it names with --view, the way the person arranging that canvas would',
        'refusals\tunknown-color\tnot-linked\tunknown-node\tnode-on-other-machine\tthe whole set this verb refuses with',
        'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
        'see\truimte-context node group --color C\ta frame around nodes in one of the same colors'
    ],
    positionals: z.tuple([z.string().min(1, 'node color needs the id of a node')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'node color takes one node id and nothing else; the color goes in --color' : 'node color needs the id of a node'
    }),
    flags: z.object({
        color: z.string({ error: `--color needs one of the colors, or ${NONE}` }).min(1, `--color needs one of the colors, or ${NONE}`),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ positionals: [id], flags, dryRun }, call) {
        if (flags.color !== NONE && !isNodeAccent(flags.color)) {
            throw new VerbRefusal('unknown-color', `${flags.color} is not one of the ${NODE_ACCENT_NAMES.length} colors a node takes, nor ${NONE}`, [
                ...COLOR_LINES
            ]);
        }
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const colored = await runAction(call, 'node.setColor', { viewId, nodeId: id, color: flags.color === NONE ? null : flags.color }, dryRun);
        return [[dryRun ? 'dry-run' : 'colored', id, colored.kind, colored.color ?? '-'].join('\t')];
    }
});
