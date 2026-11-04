import { randomBytes, randomInt } from 'node:crypto';
import { ToolRefusal } from '@adecore/agents/context';
import { DrawingEditSchema, type DrawingEditMint } from '@adecore/drawing';
import type { ActionHandlers } from '@ruimte/actions';
import { isCanvasView, isDrawingView, type ProjectContent, type ProjectDrawingView } from '@ruimte/contracts';
import type { z } from 'zod';
import { DrawingError } from '../projects/drawing-store.ts';
import { field, orNote, type CanvasHost } from '../tools/host.ts';
import { hostService, type ServerActionContext } from './context.ts';
import { MAX_PROBLEMS, parseJson, pathOf, problemsRefusal } from './json-input.ts';

/* The ids the daemon gives new elements, in the shape a person's own elements have. */
function systemMint(): DrawingEditMint {
    return { id: () => `el-${randomBytes(5).toString('hex')}`, seed: () => randomInt(2 ** 31) };
}

/* The drawing view an id means: the view itself, or the drawing a node on a canvas shows. */
function drawingOf(content: ProjectContent, id: string): ProjectDrawingView | null {
    const views = content.views;
    const viewId =
        views.find((view) => view.id === id)?.id ??
        views
            .filter(isCanvasView)
            .flatMap((canvas) => canvas.nodes)
            .find((node) => node.id === id && node.kind === 'drawing')?.viewId;
    const view = views.find((candidate) => candidate.id === viewId);
    return view !== undefined && isDrawingView(view) ? view : null;
}

/*
 * Whether the caller may write in a drawing: one a person pointed it at with `#`, one a line joins it
 * to, or one it made itself. A `#` to the canvas a drawing node stands on is not one.
 */
function mayDraw(host: CanvasHost, caller: string, view: ProjectDrawingView): boolean {
    const pointed = (host.context?.referenced?.(caller) ?? []).some(
        (reference) => reference.kind === 'drawing' && reference.sources.some((source) => source.id === view.id)
    );
    const linked = (host.context?.list(caller) ?? []).some((source) => source.kind === 'drawing' && source.id === view.id);
    return pointed || linked || view.createdBy === caller;
}

/* What a refusal may offer instead: only the drawings this same call would write in. */
function drawableLines(host: CanvasHost, caller: string, content: ProjectContent): string[] {
    return orNote(
        content.views
            .filter(isDrawingView)
            .filter((view) => mayDraw(host, caller, view))
            .map((view) => `drawing\t${view.id}\t${field(view.name)}`),
        'There is no drawing you may write in: a person points you at one with #, or draws a line to it'
    );
}

function editProblems(error: z.ZodError): ToolRefusal {
    const problems = error.issues.map((issue) => ({
        path: pathOf(issue.path) || 'edit',
        text: issue.code === 'unrecognized_keys' ? `has no field ${issue.keys.join(', ')}` : issue.message
    }));

    return problemsRefusal('bad-edit', problems);
}

export const drawingActions: ActionHandlers<ServerActionContext> = {
    'drawing.edit': async ({ viewId, revision, edit }, { actor, context, dryRun }) => {
        const { host, place } = context;
        const drawings = hostService(context, 'drawings', 'unavailable', 'This machine keeps no drawings an agent can write in');
        const content = await host.projects.read(place.projectId);
        const view = drawingOf(content, viewId);
        if (view === null) {
            throw new ToolRefusal(
                'not-a-drawing',
                `${viewId} is not a drawing view of this project, nor a node that shows one`,
                drawableLines(host, actor.id, content)
            );
        }
        if (!mayDraw(host, actor.id, view)) {
            throw new ToolRefusal(
                'not-linked',
                `${view.id} is a drawing no line joins you to and nobody pointed you at with #`,
                drawableLines(host, actor.id, content)
            );
        }
        if (edit.trim() === '') {
            throw new ToolRefusal('no-edit', 'view_drawing got an empty edit; pass the edit as JSON');
        }
        const parsed = DrawingEditSchema.safeParse(parseJson(edit, 'edit'));
        if (!parsed.success) {
            throw editProblems(parsed.error);
        }
        try {
            const edited = await drawings.edit(place.projectId, view.id, revision, parsed.data, { dryRun: dryRun === true, mint: systemMint() });
            return { output: { viewId: view.id, ...edited } };
        } catch (e) {
            if (e instanceof DrawingError) {
                throw new ToolRefusal(e.code, e.message, e.code === 'bad-edit' ? e.lines.slice(0, MAX_PROBLEMS) : e.lines);
            }
            throw e;
        }
    }
};
