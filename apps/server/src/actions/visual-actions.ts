import type { ActionHandlers } from '@ruimte/actions';
import { VISUAL_LIMITS, type ChatVisual, type VisualLayout } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { callerKind } from '../canvas/tasks.ts';
import { VerbRefusal, field, orNote, type VisualHost } from '../canvas/verb.ts';
import { PREVIEW_WIDTH } from '../visuals/renderer.ts';
import type { ServerActionContext } from './context.ts';

const HELP_LINE = 'detail\truimte-context help visual';

/* What the store refuses a page with; its message already says what to change. */
const STORE_REFUSALS: ReadonlySet<string> = new Set(['visual-invalid', 'visual-too-large']);

/* What a render refuses a preview with, each with a message that names what to do instead. */
const PREVIEW_REFUSALS: ReadonlySet<string> = new Set(['preview-unavailable', 'preview-timeout', 'preview-failed']);

/* A page the store would refuse anyway is not worth starting a browser for. */
function renderable(html: string): boolean {
    return html.trim() !== '' && Buffer.byteLength(html, 'utf8') <= VISUAL_LIMITS.bytes;
}

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

function requireEnabled(visuals: VisualHost): void {
    if (!visuals.enabled()) {
        throw new VerbRefusal('visuals-off', 'A person turned visual replies off on this machine: answer in text, and do not call visual again');
    }
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

/* The caller's chat, on a machine that keeps visuals and lets agents show them. */
async function visualChat(context: ServerActionContext, caller: string): Promise<{ visuals: VisualHost; chatId: string }> {
    const visuals = visualsOf(context);
    const chatId = await callerChat(context, caller);
    requireEnabled(visuals);
    return { visuals, chatId };
}

/* Passes on what the store refuses a page with, for the agent to change. */
async function storeRefusalsAsVerb<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
        return await work();
    } catch (e) {
        if (e instanceof CodedError && STORE_REFUSALS.has(e.code)) {
            throw new VerbRefusal(e.code, e.message, [HELP_LINE]);
        }
        throw e;
    }
}

/*
 * Shows a page above the caller's reply: only in an AI chat, only while the machine lets agents show
 * visuals, and within what the store takes. `visual show` and any action that draws a page of its
 * own, such as the table of a database query, go through here.
 */
export async function showVisual(
    context: ServerActionContext,
    caller: string,
    input: { title: string; html: string; maxHeight: number | null; layout?: VisualLayout }
): Promise<ChatVisual> {
    const { visuals, chatId } = await visualChat(context, caller);
    const heights = renderable(input.html) ? await visuals.measure?.(input.html) : undefined;
    return storeRefusalsAsVerb(() =>
        visuals.publish(chatId, {
            title: input.title,
            html: input.html,
            ...(input.layout === undefined ? {} : { layout: input.layout }),
            ...(input.maxHeight === null ? {} : { maxHeight: input.maxHeight }),
            ...(heights === undefined ? {} : { heights })
        })
    );
}

export const visualActions: ActionHandlers<ServerActionContext> = {
    'visual.write': async ({ name, html }, { actor, context }) => {
        const { visuals, chatId } = await visualChat(context, actor.id);
        const writeSource = visuals.writeSource?.bind(visuals);
        if (!writeSource) {
            throw new VerbRefusal('unavailable', 'This machine keeps no visual source files; pass the page directly to visual preview and visual show');
        }
        return { output: { path: await storeRefusalsAsVerb(() => writeSource(chatId, name, html)) } };
    },
    'visual.show': async ({ title, html, maxHeight, layout }, { actor, context }) => ({
        output: { visual: await showVisual(context, actor.id, { title, html, maxHeight, ...(layout === undefined ? {} : { layout }) }) }
    }),
    'visual.preview': async ({ html, width, appearance }, { actor, context }) => {
        const { visuals, chatId } = await visualChat(context, actor.id);
        if (html.trim() === '') {
            throw new VerbRefusal('visual-invalid', 'The page is empty; pass one self-contained HTML document', [HELP_LINE]);
        }
        if (!renderable(html)) {
            throw new VerbRefusal(
                'visual-too-large',
                `The page is larger than the ${VISUAL_LIMITS.bytes / 1024 / 1024} MiB a visual may be; load libraries from a public CDN URL and refer to large images by their http(s) URL`,
                [HELP_LINE]
            );
        }
        if (!visuals.preview) {
            throw new VerbRefusal('preview-unavailable', 'This machine renders no previews; show the page with visual show without a preview');
        }
        try {
            return { output: await visuals.preview(chatId, { html, width: width ?? PREVIEW_WIDTH.default, appearance: appearance ?? 'dark' }) };
        } catch (e) {
            if (e instanceof CodedError && PREVIEW_REFUSALS.has(e.code)) {
                throw new VerbRefusal(e.code, e.message);
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
