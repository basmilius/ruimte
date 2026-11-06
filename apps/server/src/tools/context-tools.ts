import { ToolRefusal } from '@adecore/agents/context';
import type { ActionResult } from '@ruimte/actions';
import { z } from 'zod';
import { serverActionCall } from '../actions/context.ts';
import { linesOf } from './action-tool.ts';
import { defineTool, defineToolkit, PROJECT_INPUT, VIEW_INPUT, type ToolCall } from './tool.ts';

/* The refusals of a read that name a source the caller cannot read, which the linked list then goes under. */
const UNREAD: ReadonlySet<string> = new Set(['unknown-source', 'not-linked', 'unreadable', 'view-required', 'not-on-view', 'not-a-chat-view', 'not-a-canvas']);

const TAIL_MESSAGE = 'tail is a positive whole number of lines';

interface ListedSource {
    id: string;
    kind: string;
    title: string;
    flag?: string;
    snoozedUntil?: string;
}

function refused(result: ActionResult): ToolRefusal {
    if (result.status !== 'failed') {
        return new ToolRefusal('read-failed', `The read answered ${result.status}`);
    }

    return new ToolRefusal(result.error.code, result.error.message, linesOf(result.error.details));
}

/* What a person linked to the caller, always in its own project, which is what a refused read lists under it. */
async function listed(call: ToolCall): Promise<ListedSource[]> {
    const result = await call.actions.execute('context.list', {}, serverActionCall(call.host, call.host.projects.locate(call.caller), call.caller));

    if (result.status !== 'completed') {
        throw refused(result);
    }

    return result.output.sources;
}

const contextList = defineTool('context', {
    name: 'context_list',
    description: 'Lists what a person linked to this session.',
    annotations: { readOnly: true },
    counter: 'list',
    input: z.object({}),
    async run(_input, call) {
        const sources = await listed(call);

        if (sources.length === 0) {
            return ['note\tNothing is linked to this session'];
        }

        return sources.map((source) => `${source.id}\t${source.kind}\t${source.title}\t${source.flag ?? '-'}\t${source.snoozedUntil ?? '-'}`);
    }
});

const contextRead = defineTool('context', {
    name: 'context_read',
    description: 'Prints one linked source, whole or its last lines.',
    annotations: { readOnly: true },
    counter: 'read',
    input: z.object({
        id: z
            .string({ error: 'context_read needs id, a source from context_list' })
            .min(1, 'context_read needs id, a source from context_list')
            .describe('From context_list, an agent you opened, or a # reference'),
        tail: z.number({ error: TAIL_MESSAGE }).int(TAIL_MESSAGE).min(1, TAIL_MESSAGE).optional(),
        view: VIEW_INPUT.describe('In a chat view, the canvas the source is on'),
        project: PROJECT_INPUT,
        subagent: z.string({ error: 'subagent needs the id in its > Subagent line' }).optional().describe('The id in its > Subagent line'),
        form: z.enum(['elements', 'image'], { error: 'form is elements or image' }).optional().describe("elements gives a drawing's JSON, image a png")
    }),
    async run(input, call) {
        const own = call.host.projects.locate(call.caller);
        const actionCall =
            call.reached === undefined
                ? serverActionCall(call.host, own, call.caller)
                : serverActionCall(call.host, call.reached, call.caller, false, undefined, own ?? undefined);
        const result = await call.actions.execute(
            'context.read',
            {
                sourceId: input.id,
                tail: input.tail ?? null,
                subagent: input.subagent === undefined || input.subagent === '' ? null : input.subagent,
                viewId: input.view ?? null,
                form: input.form ?? null
            },
            actionCall
        );

        if (result.status === 'completed') {
            if (result.output.image !== undefined) {
                call.image(result.output.image);
            }

            return [result.output.text];
        }

        const refusal = refused(result);

        if (!UNREAD.has(refusal.code)) {
            throw refusal;
        }

        const sources = await listed(call).catch(() => null);
        const linked = sources?.map((source) => `${source.id}\t${source.kind}\t${source.title}`) ?? [];

        throw new ToolRefusal(refusal.code, refusal.message, [...linked, ...refusal.lines]);
    }
});

export const contextToolkit = defineToolkit('context', [contextList, contextRead]);
