import { z } from 'zod';
import { DrawingAlignSchema, DrawingColorSchema } from './drawing.ts';
import { DrawingFontSchema } from './font.ts';

export const RenderBoundsSchema = z.object({ x: z.number(), y: z.number(), w: z.number().nonnegative(), h: z.number().nonnegative() });
export type RenderBounds = z.infer<typeof RenderBoundsSchema>;

// The client resolves these names in its current theme; paper and edge are the sticky-note palettes.
export const RenderColorSchema = z.object({ tone: DrawingColorSchema, palette: z.enum(['ink', 'paper', 'edge']) });
export type RenderColor = z.infer<typeof RenderColorSchema>;

export const RenderPathSchema = z.object({
    d: z.string(),
    stroke: RenderColorSchema.nullable(),
    fill: RenderColorSchema.nullable(),
    strokeWidth: z.number().nonnegative(),
    dash: z.array(z.number().nonnegative()).nullable()
});
export type RenderPath = z.infer<typeof RenderPathSchema>;

export const RenderTextSchema = z.object({
    text: z.string(),
    x: z.number(),
    // Baseline, in the element's local coordinate system.
    y: z.number(),
    size: z.number().positive(),
    bold: z.boolean(),
    align: DrawingAlignSchema,
    font: DrawingFontSchema,
    color: RenderColorSchema
});
export type RenderText = z.infer<typeof RenderTextSchema>;

export const RenderElementSchema = z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    // Translate by x/y, then rotate by angle radians about the local center.
    angle: z.number(),
    centerX: z.number(),
    centerY: z.number(),
    paths: z.array(RenderPathSchema),
    text: z.array(RenderTextSchema)
});
export type RenderElement = z.infer<typeof RenderElementSchema>;

export const RenderSceneResultSchema = z.object({
    rev: z.number().int().nonnegative(),
    bounds: RenderBoundsSchema,
    // Back to front; each element draws its paths before its text.
    elements: z.array(RenderElementSchema)
});
export type RenderSceneResult = z.infer<typeof RenderSceneResultSchema>;
