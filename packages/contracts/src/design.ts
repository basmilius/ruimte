import { z } from 'zod';
import { ProjectIdSchema } from './project.ts';

/* One page of a design of a project: the design by its id, so a client names no folder, and the page by its path inside the folder. */
export const DesignPagePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    designId: z.string().min(1),
    file: z.string().min(1).max(1024),
    // With the bootstrap of a visual in its head, for a client that draws the page and has no bootstrap of its own to add.
    bootstrap: z.boolean().optional()
});
export type DesignPagePayload = z.infer<typeof DesignPagePayloadSchema>;

/*
 * The page standing on its own, held by the machine for the client that asked. A page may be as large as a
 * visual, which is more than one frame carries, so its bytes travel as `bytes.read` of `designPage` in
 * pieces; the machine lets go of it once every byte went out or the client left.
 */
const DesignPageHeldSchema = z.object({
    kind: z.literal('page'),
    pageId: z.string().min(1).max(64),
    size: z.number().int().nonnegative()
});

const DesignPageMissingSchema = z.object({ kind: z.literal('missing'), name: z.string() });

const DesignPageTooLargeSchema = z.object({
    kind: z.literal('too-large'),
    name: z.string(),
    // What the page weighs with what it cannot leave out, against what a page may weigh.
    size: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative()
});

const DesignPageNotTextSchema = z.object({ kind: z.literal('not-text'), name: z.string() });

/* Why a page was not built, which a client words for a person itself. */
export const DesignPageFailureSchema = z.discriminatedUnion('kind', [DesignPageMissingSchema, DesignPageTooLargeSchema, DesignPageNotTextSchema]);
export type DesignPageFailure = z.infer<typeof DesignPageFailureSchema>;

export const DesignPageResultSchema = z.discriminatedUnion('kind', [
    DesignPageHeldSchema,
    DesignPageMissingSchema,
    DesignPageTooLargeSchema,
    DesignPageNotTextSchema
]);
export type DesignPageResult = z.infer<typeof DesignPageResultSchema>;

export const DESIGN_REQUEST_SCHEMAS = {
    'design.page': { payload: DesignPagePayloadSchema, result: DesignPageResultSchema }
} as const;
