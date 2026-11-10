import { z } from 'zod';
import { field, placeOf, titleField } from '../canvas/host.ts';
import { idList } from '../canvas/nodes.ts';
import { canvasIdFor, defineActionTool, runAction } from './action-tool.ts';
import { idsInput } from './batch.ts';
import { defineToolkit, PROJECT_INPUT, VIEW_INPUT } from './tool.ts';

const OFF_CANVAS = 'This session is not on a canvas; name one with view';

const linkList = defineActionTool('link', {
    name: 'link_list',
    action: 'link.list',
    description: 'Lists the lines of a canvas.',
    annotations: { readOnly: true },
    input: z.object({ view: VIEW_INPUT, project: PROJECT_INPUT }),
    async run(input, call) {
        const listed = await runAction(call, 'link.list', { viewId: await canvasIdFor(call, placeOf(call), input.view, OFF_CANVAS) });

        return [...listed.edges.map((edge) => [edge.edgeId, edge.from, edge.to, field(edge.label ?? '')].join('\t')), `revision\t${listed.revision}`];
    }
});

const linkNew = defineActionTool('link', {
    name: 'link_new',
    action: 'link.create',
    description: 'Draws a context line between nodes of one canvas.',
    input: z.object({
        to: z.string({ error: 'link_new needs to, one or more node ids separated by commas' }).min(1, 'to needs one or more node ids, separated by commas'),
        from: z.string().min(1, 'from needs the id of a node on that canvas').optional().describe('Without it, you'),
        label: titleField('label', 'label needs a word').optional(),
        role: z.string().min(1, 'role needs one of context, target, origin').optional().describe('context, target or origin'),
        view: VIEW_INPUT
    }),
    async run(input, call) {
        const to = idList(input.to, 'to');
        const viewId = await canvasIdFor(call, placeOf(call), input.view, OFF_CANVAS);
        const linked = await runAction(call, 'link.create', { viewId, from: input.from ?? null, to, label: input.label ?? null, role: input.role ?? null });

        return linked.edges.map((edge) => [edge.edgeId, edge.from, edge.to, edge.state, edge.way].join('\t'));
    }
});

const linkDelete = defineActionTool('link', {
    name: 'link_delete',
    action: 'link.delete',
    description: 'Removes lines whose ends are both yours.',
    annotations: { destructive: true },
    input: z.object({ edge_id: idsInput('edge_id', 'lines to remove'), view: VIEW_INPUT }),
    async run(input, call) {
        const viewId = await canvasIdFor(call, placeOf(call), input.view, OFF_CANVAS);
        const [first, ...rest] = input.edge_id;
        const edges =
            first !== undefined && rest.length === 0
                ? [await runAction(call, 'link.delete', { viewId, edgeId: first })]
                : (await runAction(call, 'link.deleteMany', { viewId, edgeIds: input.edge_id })).edges;

        return edges.map((edge) => ['deleted', edge.edgeId, edge.from, edge.to, field(edge.label ?? '')].join('\t'));
    }
});

export const linkToolkit = defineToolkit('link', [linkList, linkNew, linkDelete]);
