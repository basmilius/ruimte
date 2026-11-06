import { VISUAL_LIMITS, VisualLayoutSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { visualRow, visualRows } from '../actions/visual-actions.ts';
import { prepareVisualPage, type ImageFiles } from '../agent-files/visual-images.ts';
import { field, requiredField } from '../canvas/host.ts';
import { PREVIEW_WIDTH } from '../visuals/renderer.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit, type ToolCall } from './tool.ts';

/* A model that is not told so describes the page in its reply as well, which the person then reads twice. */
export const SHOWN_LINE =
    'shown\tThe person sees this page above your reply. Do not mention or describe it there: your reply adds only what the page does not say';

/*
 * The page with the local images it names embedded, read only inside the folders of `mcp/files.ts`, and
 * a line per image a preview left as written. A page left out is empty, which the action refuses.
 */
async function pageOf(action: 'show' | 'preview', html: string | undefined, call: ToolCall): Promise<{ html: string; lines: string[] }> {
    if (html === undefined) {
        return { html: '', lines: [] };
    }

    // Read only once the page names a local image, so a page without one needs no folders of the caller.
    const files: ImageFiles = {
        size: async (path) => (await call.files()).images().size(path),
        read: async (path, into) => (await call.files()).images().read(path, into)
    };

    return prepareVisualPage(action, html, { files });
}

const visualWrite = defineActionTool('visual', {
    name: 'visual_write',
    action: 'visual.write',
    description: "Saves an HTML file in this chat's visual folder, without showing it.",
    audience: 'chat',
    input: z.object({
        name: z.string({ error: 'visual_write needs name, an HTML filename such as chart.html' }).describe('An .html filename'),
        html: z.string().optional()
    }),
    async run(input, call) {
        const { path } = await runAction(call, 'visual.write', { name: input.name, html: input.html ?? '' });

        return [
            `file\t${field(path)}`,
            'next\tThis saved the source without showing it: send the same page as html to visual_preview, then visual_show. visual_write with the same name updates the source'
        ];
    }
});

const visualPreview = defineActionTool('visual', {
    name: 'visual_preview',
    action: 'visual.preview',
    description: 'Renders an HTML page to a png without showing it.',
    annotations: { readOnly: true },
    audience: 'chat',
    input: z.object({
        width: z
            .number({ error: 'width takes a whole number of CSS pixels' })
            .int('width takes a whole number of CSS pixels')
            .min(PREVIEW_WIDTH.min, `width is from ${PREVIEW_WIDTH.min} to ${PREVIEW_WIDTH.max} CSS pixels`)
            .max(PREVIEW_WIDTH.max, `width is from ${PREVIEW_WIDTH.min} to ${PREVIEW_WIDTH.max} CSS pixels`)
            .optional()
            .describe(`CSS pixels; the reply column is ${PREVIEW_WIDTH.default}`),
        appearance: z.enum(['dark', 'light'], { error: 'appearance is dark or light' }).optional(),
        html: z.string().optional()
    }),
    async run(input, call) {
        const page = await pageOf('preview', input.html, call);
        const shown = await runAction(call, 'visual.preview', { html: page.html, width: input.width ?? null, appearance: input.appearance ?? null });
        call.image(shown.path);

        return [
            `shot\t${field(shown.path)}\tthe png on this machine, which you open with your own tools`,
            `height\t${shown.height}\tthe height the page needs at ${shown.width}px`,
            ...(shown.shotHeight < shown.height ? [`note\tThe shot covers the first ${shown.shotHeight} of those pixels`] : []),
            ...(shown.console.length === 0
                ? ['note\tThe page wrote nothing to its console']
                : shown.console.map((entry) => `console\t${entry.level}\t${field(entry.text)}`)),
            ...(shown.omitted > 0 ? [`note\t${shown.omitted} more console messages were left out`] : []),
            'next\tThis only checked the page; visual_show with a title and the same page in html shows it above your reply',
            ...page.lines
        ];
    }
});

const visualShow = defineActionTool('visual', {
    name: 'visual_show',
    action: 'visual.show',
    description: 'Shows a self-contained HTML page above your reply in this chat.',
    audience: 'chat',
    input: z.object({
        title: z.string({ error: 'visual_show needs title, a few words that say what the page shows' }),
        layout: VisualLayoutSchema.optional().describe('wide for mockups and dashboards'),
        height: z
            .number({ error: 'height takes a whole number of CSS pixels' })
            .int('height takes a whole number of CSS pixels')
            .min(VISUAL_LIMITS.minHeight, `height is from ${VISUAL_LIMITS.minHeight} to ${VISUAL_LIMITS.maxHeight} CSS pixels`)
            .max(VISUAL_LIMITS.maxHeight, `height is from ${VISUAL_LIMITS.minHeight} to ${VISUAL_LIMITS.maxHeight} CSS pixels`)
            .optional()
            .describe('The most it grows, in CSS pixels'),
        html: z.string().optional()
    }),
    async run(input, call) {
        const page = await pageOf('show', input.html, call);
        const { visual } = await runAction(call, 'visual.show', {
            title: input.title,
            html: page.html,
            maxHeight: input.height ?? null,
            ...(input.layout === undefined ? {} : { layout: input.layout })
        });

        return [visualRow(visual), SHOWN_LINE];
    }
});

const visualList = defineActionTool('visual', {
    name: 'visual_list',
    action: 'visual.list',
    description: 'Lists the visuals of this chat in the order they were shown.',
    annotations: { readOnly: true },
    audience: 'chat',
    input: z.object({}),
    async run(_input, call) {
        const { visuals } = await runAction(call, 'visual.list', {});

        return visualRows(visuals);
    }
});

const visualRemove = defineActionTool('visual', {
    name: 'visual_remove',
    action: 'visual.remove',
    description: 'Takes a visual of this chat out of its thread.',
    annotations: { destructive: true },
    audience: 'chat',
    input: z.object({ visual_id: requiredField('visual_remove needs visual_id, the id of a visual; visual_list lists them') }),
    async run(input, call) {
        const removed = await runAction(call, 'visual.remove', { visualId: input.visual_id });

        return [`removed\t${removed.visualId}\t${field(removed.title)}`];
    }
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const visualToolkit = defineToolkit('visual', [visualWrite, visualPreview, visualShow, visualList, visualRemove]);
