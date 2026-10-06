import type { ActionHandlers } from '@ruimte/actions';
import type { ChatVisual } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { callerKind } from '../canvas/tasks.ts';
import { VerbRefusal, field, orNote, type VisualHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

const HELP_LINE = 'detail\truimte-context help visual';

/* What the store refuses a page with; its message already says what to change. */
const STORE_REFUSALS: ReadonlySet<string> = new Set(['visual-invalid', 'visual-too-large']);

export function visualRow(visual: ChatVisual): string {
    return `visual\t${visual.id}\t${field(visual.title)}\t${visual.size} bytes`;
}

export function visualRows(visuals: readonly ChatVisual[]): string[] {
    return orNote(visuals.map(visualRow), 'This chat shows no visual');
}

function visualsOf({ host }: ServerActionContext): VisualHost {
    if (!host.visuals) {
        throw new VerbRefusal('unavailable', 'This machine keeps no visuals; answer in text');
    }
    return host.visuals;
}

/* A visual shows in the thread of an AI chat, and a terminal has no thread to show it in. */
async function callerChat({ host, place }: ServerActionContext, caller: string): Promise<string> {
    const kind = callerKind(await host.read(place.projectId), caller) ?? host.hiddenAgents?.get(caller)?.node.kind ?? null;
    if (kind !== 'chat') {
        throw new VerbRefusal(
            'visual-needs-chat',
            `A visual shows only in the thread of an AI chat, and you are ${kind === null ? 'not a node of this project' : `a ${kind}`}: answer in text instead`
        );
    }
    return caller;
}

export const visualActions: ActionHandlers<ServerActionContext> = {
    'visual.show': async ({ title, html, maxHeight }, { actor, context }) => {
        const visuals = visualsOf(context);
        const chatId = await callerChat(context, actor.id);
        if (!visuals.enabled()) {
            throw new VerbRefusal('visuals-off', 'A person turned visual replies off on this machine: answer in text, and do not call visual again');
        }
        try {
            return { output: { visual: await visuals.publish(chatId, { title, html, ...(maxHeight === null ? {} : { maxHeight }) }) } };
        } catch (e) {
            if (e instanceof CodedError && STORE_REFUSALS.has(e.code)) {
                throw new VerbRefusal(e.code, e.message, [HELP_LINE]);
            }
            throw e;
        }
    },
    'visual.list': async (_input, { actor, context }) => ({
        output: { visuals: await visualsOf(context).list(await callerChat(context, actor.id)) }
    }),
    'visual.remove': async ({ visualId }, { actor, context }) => {
        const visuals = visualsOf(context);
        const chatId = await callerChat(context, actor.id);
        const shown = await visuals.list(chatId);
        const visual = shown.find((candidate) => candidate.id === visualId);
        if (!visual) {
            throw new VerbRefusal('visual-not-found', `This chat shows no visual ${visualId}`, visualRows(shown));
        }
        await visuals.remove(chatId, visualId);
        return { output: { visualId, title: visual.title } };
    }
};
