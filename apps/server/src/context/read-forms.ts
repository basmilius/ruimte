import { VISUAL_LIMITS, isCanvasView, type ContextSource, type DrawingElement } from '@ruimte/contracts';
import { DEFAULT_PALETTE, toSvg as drawingSvg } from '@adecore/drawing';
import { toSvg as diagramSvg } from '@adecore/diagram';
import { CodedError } from '@adecore/agents';
import { ToolRefusal } from '@adecore/agents/context';
import { callerChat } from '../actions/visual-actions.ts';
import type { ServerActionContext } from '../actions/context.ts';
import { PREVIEW_WIDTH } from '../visuals/renderer.ts';
import { SHOT_MAX_HEIGHT } from '../visuals/render-protocol.ts';
import { canvasSvg, renderCanvas } from './context-canvas.ts';
import { renderDatabaseView } from './context-database.ts';
import { ContextRefusal, type ContextReading } from './context-store.ts';
import type { Reference } from './references.ts';

export type ReadForm = 'elements' | 'image';

const PAPER = '#ffffff';
const PREVIEW_REFUSALS: ReadonlySet<string> = new Set(['preview-unavailable', 'preview-timeout', 'preview-failed']);

function formRefusal(form: ReadForm, kind: string): ToolRefusal {
    return form === 'elements'
        ? new ToolRefusal('bad-arguments', `form elements reads only a drawing, and this is a ${kind}; read it without form`)
        : new ToolRefusal('bad-arguments', `form image draws only a drawing, a diagram or a canvas, and this is a ${kind}; read it without form`);
}

/* The width a picture is rendered at: its own, within what a preview takes, and narrower where it would run past the tallest png. */
export function imageWidth(svg: string): number {
    const size = /^<svg[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(svg);
    const width = Number(size?.[1] ?? PREVIEW_WIDTH.default);
    const height = Number(size?.[2] ?? 1);
    const fitted = Math.max(1, Math.floor(width * Math.min(1, PREVIEW_WIDTH.max / width, SHOT_MAX_HEIGHT / height)));
    // A small drawing is drawn larger, as long as that keeps it within the tallest png.
    const widened = Math.min(PREVIEW_WIDTH.min, Math.floor((SHOT_MAX_HEIGHT * width) / height));
    return Math.max(fitted, widened);
}

export function imagePage(svg: string, width: number): string {
    return `<!doctype html><html><head><style>html,body{margin:0;background:${PAPER}}svg{display:block;width:${width}px;height:auto}</style></head><body>${svg}</body></html>`;
}

/* A picture through the render children `visual_preview` uses, as a png in the caller's own chat folder. */
async function image(context: ServerActionContext, caller: string, title: string, svg: string): Promise<ContextReading> {
    const chatId = await callerChat(context, caller);
    const visuals = context.host.visuals;
    if (!visuals?.preview) {
        throw new ToolRefusal('preview-unavailable', 'This machine renders no pictures; read the source without form image');
    }
    const width = imageWidth(svg);
    const html = imagePage(svg, width);
    if (Buffer.byteLength(html, 'utf8') > VISUAL_LIMITS.bytes) {
        throw new ToolRefusal('visual-too-large', `${title} is too large to render as one picture; read its text or its elements instead`);
    }
    try {
        const preview = await visuals.preview(chatId, { html, width, appearance: 'light' });
        return {
            image: preview.path,
            text: [
                `PNG of ${JSON.stringify(title)}, ${preview.width}x${preview.shotHeight}:`,
                preview.path,
                '',
                'Open it with your own tool that reads images.'
            ].join('\n')
        };
    } catch (e) {
        if (e instanceof CodedError && PREVIEW_REFUSALS.has(e.code)) {
            throw new ToolRefusal(e.code, e.message);
        }
        throw e;
    }
}

/* An element as an agent edits it: where it stands, its colors and its words, and nothing of how it wobbles. */
function elementSummary(element: DrawingElement): Record<string, unknown> {
    return {
        id: element.id,
        kind: element.kind,
        box: { x: element.x, y: element.y, w: element.w, h: element.h },
        stroke: element.stroke,
        ...(element.fill === undefined ? {} : { fill: element.fill }),
        ...(element.fillColor === undefined ? {} : { fillColor: element.fillColor }),
        ...(element.kind === 'text' || element.kind === 'note' ? { text: element.text } : {}),
        ...(element.locked === true ? { locked: true } : {})
    };
}

/* A canvas or a database view a person pointed the caller at: neither is a source a line could reach. */
export async function readReference(context: ServerActionContext, caller: string, reference: Reference, form: ReadForm | null): Promise<ContextReading> {
    const { host, place } = context;
    if (reference.kind === 'database' && reference.database !== undefined) {
        if (form !== null) {
            throw formRefusal(form, 'database view');
        }
        const connections = await host.databases?.list({ projectId: place.projectId, folder: place.folder }).catch(() => []);
        const connection = connections?.find((candidate) => candidate.id === reference.database!.connectionId) ?? null;
        return { text: renderDatabaseView(reference.name, reference.database, connection) };
    }
    const canvas = (await host.projects.read(place.projectId)).views.find((view) => view.id === reference.id);
    if (canvas === undefined || !isCanvasView(canvas)) {
        throw new ContextRefusal('unreadable', `${reference.id} is no longer a canvas of this project`);
    }
    if (form === 'elements') {
        throw formRefusal(form, 'canvas');
    }
    return form === 'image' ? image(context, caller, canvas.name, canvasSvg(canvas)) : { text: renderCanvas(canvas) };
}

/* A drawing or a diagram the caller may read, as its elements or as a picture. */
export async function readInForm(context: ServerActionContext, caller: string, source: ContextSource, form: ReadForm): Promise<ContextReading> {
    const { host, place } = context;
    if (source.kind === 'drawing') {
        const document = (await host.drawings?.read(place.projectId, source.id)) ?? null;
        if (document === null) {
            throw new ContextRefusal('unreadable', `${source.id} is there, but its drawing cannot be read right now`);
        }
        if (form === 'image') {
            return image(context, caller, source.title, drawingSvg(document.elements, { palette: DEFAULT_PALETTE, background: PAPER }));
        }
        return { text: JSON.stringify({ viewId: source.id, revision: document.rev, elements: document.elements.map(elementSummary) }, null, 2) };
    }
    if (source.kind === 'diagram' && form === 'image') {
        const document = (await host.diagrams.read?.(place.projectId, source.id)) ?? null;
        if (document === null) {
            throw new ContextRefusal('unreadable', `${source.id} is there, but its diagram cannot be read right now`);
        }
        return image(context, caller, source.title, diagramSvg(document, { background: PAPER }));
    }
    throw formRefusal(form, source.kind);
}
