import { z } from 'zod';
import { ProjectIdSchema, ProjectSaveResultSchema } from './project.ts';
import { DrawingContentSchema, DrawingDocumentSchema } from '@adecore/drawing/protocol';

export {
    DrawingColorSchema,
    type DrawingColor,
    DRAWING_COLORS,
    DrawingFillSchema,
    type DrawingFill,
    DrawingStrokeStyleSchema,
    type DrawingStrokeStyle,
    DrawingStrokeWidthSchema,
    type DrawingStrokeWidth,
    DrawingRoughnessSchema,
    type DrawingRoughness,
    DrawingAlignSchema,
    type DrawingAlign,
    DRAWING_TEXT_SIZE_MIN,
    DRAWING_TEXT_SIZE_MAX,
    DrawingElementSchema,
    type DrawingElement,
    type DrawingElementKind,
    DRAWING_VERSION,
    DrawingContentSchema,
    type DrawingContent,
    DrawingDocumentSchema,
    type DrawingDocument,
    EMPTY_DRAWING,
    migrateDrawing,
    duplicateElementIdIn
} from '@adecore/drawing/protocol';

export const DrawingTargetPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1)
});
export type DrawingTargetPayload = z.infer<typeof DrawingTargetPayloadSchema>;

export const DrawingOpenResultSchema = z.object({
    document: DrawingDocumentSchema
});
export type DrawingOpenResult = z.infer<typeof DrawingOpenResultSchema>;

export const DrawingSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    // The rev the client last loaded; the daemon refuses when the file moved on.
    baseRev: z.number().int().nonnegative(),
    content: DrawingContentSchema
});
export type DrawingSavePayload = z.infer<typeof DrawingSavePayloadSchema>;

export const DrawingSaveResultSchema = ProjectSaveResultSchema;
export type DrawingSaveResult = z.infer<typeof DrawingSaveResultSchema>;

// Duplicating a view: the daemon copies the file under the new id at rev 0.
export const DrawingCopyPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    from: z.string().min(1),
    to: z.string().min(1)
});
export type DrawingCopyPayload = z.infer<typeof DrawingCopyPayloadSchema>;

// The file changed under the daemon (a git pull, another machine); carries what is on disk now.
export const DrawingChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    document: DrawingDocumentSchema
});
export type DrawingChangedEvent = z.infer<typeof DrawingChangedEventSchema>;
