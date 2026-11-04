import { DrawingContentSchema, DrawingDocumentSchema } from '@adecore/drawing/protocol';
import { z } from 'zod';
import { ProjectIdSchema, ProjectSaveResultSchema } from './project.ts';

export {
    DrawingColorSchema,
    type DrawingColor,
    DrawingFontSchema,
    type DrawingFont,
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

export const DrawingOpenResultSchema = z.object({
    document: DrawingDocumentSchema
});

export const DrawingSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    // The rev the client last loaded; the daemon refuses when the file moved on.
    baseRev: z.number().int().nonnegative(),
    content: DrawingContentSchema
});

export const DrawingSaveResultSchema = ProjectSaveResultSchema;

// Duplicating a view: the daemon copies the file under the new id at rev 0.
export const DrawingCopyPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    from: z.string().min(1),
    to: z.string().min(1)
});

// The file changed under the daemon (a git pull, another machine); carries what is on disk now.
export const DrawingChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    document: DrawingDocumentSchema
});
