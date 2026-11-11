import { CodedError } from '@adecore/agents';
import { ToolRefusal } from '@adecore/agents/context';
import type { ActionHandlers } from '@ruimte/actions';
import { DesignPageError, VISUAL_LIMITS, type ChatVisual, type DesignPageFailure, type VisualLayout } from '@ruimte/contracts';
import { field, orNote } from '../canvas/host.ts';
import { assembleDesignPage, designFoldersOf, designPageByPath } from '../fs/design-page.ts';
import type { VisualHost } from '../visuals/agent-host.ts';
import { PREVIEW_WIDTH } from '../visuals/renderer.ts';
import { hostService, requireChatCaller, type ServerActionContext } from './context.ts';

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

function visualsOf(context: ServerActionContext): VisualHost {
    return hostService(context, 'visuals', 'unavailable', 'This machine keeps no visuals; answer in text');
}

function requireEnabled(visuals: VisualHost): void {
    if (!visuals.enabled()) {
        throw new ToolRefusal('visuals-off', 'A person turned visual replies off on this machine: answer in text, and do not call visual again');
    }
}

/* A visual shows in the thread of an AI chat, and a terminal has no thread to show it in. */
export async function callerChat(context: ServerActionContext, caller: string): Promise<string> {
    await requireChatCaller(
        context,
        caller,
        (you) => new ToolRefusal('visual-needs-chat', `A visual shows only in the thread of an AI chat, and you are ${you}: answer in text instead`)
    );

    return caller;
}

/* The caller's chat, on a machine that keeps visuals and lets agents show them. */
async function visualChat(context: ServerActionContext, caller: string): Promise<{ visuals: VisualHost; chatId: string }> {
    const visuals = visualsOf(context);
    const chatId = await callerChat(context, caller);
    requireEnabled(visuals);
    return { visuals, chatId };
}

function designFailureRefusal(failure: DesignPageFailure, folder: string): ToolRefusal {
    switch (failure.kind) {
        case 'missing':
            return new ToolRefusal('design-page-missing', `design_page names ${failure.name}, which is not in the design folder ${folder}`);
        case 'too-large':
            return new ToolRefusal(
                'visual-too-large',
                `${failure.name} with what it carries is ${failure.size} bytes, and a page may be at most ${failure.limit}; load libraries from a public CDN URL and refer to large images by their http(s) URL`
            );
        case 'not-text':
            return new ToolRefusal('design-page-not-text', `design_page names ${failure.name}, which is not UTF-8 text`);
    }
}

/*
 * A page of a design folder of the caller's project standing on its own, built as the design view builds
 * it, so a preview shows what a person sees. A path outside every design folder of the project is refused
 * with the folders it may name.
 */
async function designPageHtml(context: ServerActionContext, path: string): Promise<string> {
    const designs = hostService(context, 'designs', 'unavailable', 'This machine reads no designs; pass the page as html');
    const { projectId, folder } = context.place;
    const project = { folder, ...(await designs.sides(projectId)) };
    const page = designPageByPath(project, path);
    if (page === null) {
        const folders = designFoldersOf(project).map((design) => `folder\t${field(design.folder)}`);
        throw new ToolRefusal(
            'not-a-design-page',
            'design_page takes the path of an HTML page inside a design folder of this project',
            orNote(folders, 'This project has no design')
        );
    }
    try {
        return await assembleDesignPage(folder, page);
    } catch (e) {
        if (e instanceof DesignPageError) {
            throw designFailureRefusal(e.failure, page.folder);
        }
        throw e;
    }
}

async function storeRefusalsAsTool<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
        return await work();
    } catch (e) {
        if (e instanceof CodedError && STORE_REFUSALS.has(e.code)) {
            throw new ToolRefusal(e.code, e.message);
        }
        throw e;
    }
}

/*
 * Shows a page above the caller's reply: only in an AI chat, only while the machine lets agents show
 * visuals, and within what the store takes. `visual_show` and any action that draws a page of its
 * own, such as the table of a database query, go through here.
 */
export async function showVisual(
    context: ServerActionContext,
    caller: string,
    input: { title: string; html: string; maxHeight: number | null; layout?: VisualLayout }
): Promise<ChatVisual> {
    const { visuals, chatId } = await visualChat(context, caller);
    const heights = renderable(input.html) ? await visuals.measure?.(input.html) : undefined;
    return storeRefusalsAsTool(() =>
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
            throw new ToolRefusal('unavailable', 'This machine keeps no visual source files; pass the page directly to visual_preview and visual_show');
        }
        return { output: { path: await storeRefusalsAsTool(() => writeSource(chatId, name, html)) } };
    },
    'visual.show': async ({ title, html, maxHeight, layout }, { actor, context }) => ({
        output: { visual: await showVisual(context, actor.id, { title, html, maxHeight, ...(layout === undefined ? {} : { layout }) }) }
    }),
    'visual.preview': async ({ html: given, width, appearance, designPage }, { actor, context }) => {
        const { visuals, chatId } = await visualChat(context, actor.id);
        if (designPage !== undefined && given.trim() !== '') {
            throw new ToolRefusal('two-pages', 'visual_preview takes html or design_page, not both');
        }
        const html = designPage === undefined ? given : await designPageHtml(context, designPage);
        if (html.trim() === '') {
            throw new ToolRefusal('visual-invalid', 'The page is empty; pass one self-contained HTML document');
        }
        if (!renderable(html)) {
            throw new ToolRefusal(
                'visual-too-large',
                `The page is larger than the ${VISUAL_LIMITS.bytes / 1024 / 1024} MiB a visual may be; load libraries from a public CDN URL and refer to large images by their http(s) URL`
            );
        }
        if (!visuals.preview) {
            throw new ToolRefusal('preview-unavailable', 'This machine renders no previews; show the page with visual_show without a preview');
        }
        try {
            return { output: await visuals.preview(chatId, { html, width: width ?? PREVIEW_WIDTH.default, appearance: appearance ?? 'dark' }) };
        } catch (e) {
            if (e instanceof CodedError && PREVIEW_REFUSALS.has(e.code)) {
                throw new ToolRefusal(e.code, e.message);
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
            throw new ToolRefusal('visual-not-found', `This chat shows no visual ${visualId}`, visualRows(shown));
        }
        await visuals.remove(chatId, visualId);
        return { output: { visualId, title: visual.title } };
    }
};
