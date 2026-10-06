import { z } from 'zod';

/*
 * What the daemon and its render child say to each other: one request as a line of JSON on the
 * child's stdin, one answer as a line of JSON on its stdout. The daemon keeps stdin open while it
 * waits, so the child sees its end when the daemon goes, however it goes.
 */

export const RENDER_COMMAND = 'visual-render';

/* The tallest a preview's png gets; the height it reports is the page's whole. */
export const SHOT_MAX_HEIGHT = 4000;

export const RenderRequestSchema = z.object({
    html: z.string(),
    // CSS pixels; one browser view per width, all at once.
    widths: z.array(z.number().int().min(1).max(4096)).min(1).max(16),
    appearance: z.enum(['dark', 'light']),
    // A preview: the console and a png of the first width as well as its height.
    capture: z.boolean(),
    // The throwaway profile folder; the daemon made it and removes it.
    profile: z.string().min(1),
    // How long the child may take before it answers with what it has.
    budgetMs: z.number().positive()
});
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export const ConsoleEntrySchema = z.object({
    level: z.enum(['log', 'info', 'warning', 'error', 'exception']),
    text: z.string()
});

export const RenderedPageSchema = z.object({
    width: z.number(),
    height: z.number(),
    // Base64 png, `shotHeight` pixels tall; only with `capture`.
    shot: z.string().optional(),
    shotHeight: z.number().optional(),
    console: z.array(ConsoleEntrySchema).optional(),
    omitted: z.number().optional()
});
export type RenderedPage = z.infer<typeof RenderedPageSchema>;

export const RenderAnswerSchema = z.discriminatedUnion('ok', [
    // The widths that finished within the budget, which may be fewer than were asked.
    z.object({ ok: z.literal(true), pages: z.array(RenderedPageSchema) }),
    z.object({ ok: z.literal(false), code: z.enum(['browser-unavailable', 'render-failed']), message: z.string() })
]);
export type RenderAnswer = z.infer<typeof RenderAnswerSchema>;
