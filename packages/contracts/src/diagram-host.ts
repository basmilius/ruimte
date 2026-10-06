import { z } from 'zod';
import { ProjectIdSchema, ProjectSaveResultSchema } from './project.ts';
import { DiagramContentSchema, DiagramDocumentSchema } from '@adecore/diagram/protocol';

export {
    DiagramShapeSchema,
    type DiagramShape,
    DIAGRAM_SHAPES,
    DiagramDirectionSchema,
    type DiagramDirection,
    DiagramEdgeStyleSchema,
    type DiagramEdgeStyle,
    DiagramNodeSchema,
    type DiagramNode,
    DiagramGroupSchema,
    type DiagramGroup,
    DiagramEdgeSchema,
    type DiagramEdge,
    DiagramMetaSchema,
    type DiagramMeta,
    DIAGRAM_VERSION,
    DIAGRAM_LIMITS,
    DiagramContentSchema,
    type DiagramContent,
    DiagramDocumentSchema,
    type DiagramDocument,
    EMPTY_DIAGRAM,
    migrateDiagram,
    diagramProblemIn
} from '@adecore/diagram/protocol';

export const DiagramTargetPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1)
});
export type DiagramTargetPayload = z.infer<typeof DiagramTargetPayloadSchema>;

export const DiagramOpenResultSchema = z.object({
    document: DiagramDocumentSchema
});
export type DiagramOpenResult = z.infer<typeof DiagramOpenResultSchema>;

export const DiagramSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    // The rev the client last loaded; the daemon refuses when the file moved on.
    baseRev: z.number().int().nonnegative(),
    content: DiagramContentSchema
});
export type DiagramSavePayload = z.infer<typeof DiagramSavePayloadSchema>;

export const DiagramSaveResultSchema = ProjectSaveResultSchema;
export type DiagramSaveResult = z.infer<typeof DiagramSaveResultSchema>;

// Duplicating a view: the daemon copies the file under the new id at rev 0.
export const DiagramCopyPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    from: z.string().min(1),
    to: z.string().min(1)
});
export type DiagramCopyPayload = z.infer<typeof DiagramCopyPayloadSchema>;

// The file changed under the daemon (a hand edit, a git pull, an agent); carries what is on disk now.
export const DiagramChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    document: DiagramDocumentSchema
});
export type DiagramChangedEvent = z.infer<typeof DiagramChangedEventSchema>;
