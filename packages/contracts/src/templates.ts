import { z } from 'zod';
import { ProjectIdSchema } from './project.ts';

/*
 * Templates of the editor: live templates that expand on Tab and postfix templates that wrap the
 * expression before a dot. A person's own live in `$RUIMTE_HOME/editor-templates.json`; a project may
 * carry shared ones in `.ruimte/templates.json`. A template executes nothing, it only inserts text.
 */

export const TEMPLATES_VERSION = 1;

export const TEMPLATE_LIMITS = {
    key: 40,
    body: 20_000,
    description: 500,
    example: 200
} as const;

/* The families a live template names; anything not listed is `other`. */
export const TEMPLATE_LANGUAGES = ['javascript', 'typescript', 'php', 'css', 'html', 'xml', 'other'] as const;

export const POSTFIX_TEMPLATE_LANGUAGES = ['javascript', 'typescript', 'php'] as const;

export const TEMPLATE_PLACES = ['code', 'comment', 'string'] as const;

/* The ids of the templates that ship with the editor start with this; a stored template never does. */
export const BUILT_IN_TEMPLATE_PREFIX = 'builtin.';

/* Who put a template there when it was not a person. */
export const TemplateAddedBySchema = z.object({
    kind: z.literal('agent'),
    chatId: z.string().min(1),
    // Epoch ms.
    at: z.number().int().nonnegative()
});
export type TemplateAddedBy = z.infer<typeof TemplateAddedBySchema>;

/*
 * The languages and places stay plain strings: a file written by a newer Ruimte may name a family this
 * one does not know, and the template is still read. A save checks them against the lists above.
 */
export const LiveTemplateSchema = z.object({
    id: z.string().min(1),
    key: z.string(),
    body: z.string(),
    description: z.string().optional(),
    languages: z.array(z.string()),
    places: z.array(z.string()).optional(),
    addedBy: TemplateAddedBySchema.optional()
});
export type LiveTemplate = z.infer<typeof LiveTemplateSchema>;

export const PostfixTemplateSchema = z.object({
    id: z.string().min(1),
    key: z.string(),
    body: z.string(),
    description: z.string().optional(),
    example: z.string().optional(),
    languages: z.array(z.string()),
    expression: z.enum(['any', 'statement']).optional(),
    addedBy: TemplateAddedBySchema.optional()
});
export type PostfixTemplate = z.infer<typeof PostfixTemplateSchema>;

/* What a client sends: the daemon assigns the id of a new template, and only the daemon writes `addedBy`. */
export const LiveTemplateInputSchema = LiveTemplateSchema.omit({ id: true, addedBy: true }).extend({ id: z.string().min(1).optional() });
export type LiveTemplateInput = z.infer<typeof LiveTemplateInputSchema>;

export const PostfixTemplateInputSchema = PostfixTemplateSchema.omit({ id: true, addedBy: true }).extend({ id: z.string().min(1).optional() });
export type PostfixTemplateInput = z.infer<typeof PostfixTemplateInputSchema>;

export const TemplateSettingsSchema = z.object({
    liveInCompletion: z.boolean().optional(),
    postfix: z.boolean().optional(),
    postfixInCompletion: z.boolean().optional()
});
export type TemplateSettings = z.infer<typeof TemplateSettingsSchema>;

export const TemplateScopeSchema = z.enum(['personal', 'project']);
export type TemplateScope = z.infer<typeof TemplateScopeSchema>;

export const TemplateKindSchema = z.enum(['live', 'postfix']);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;

/* Goes up on every change of a file, also one made outside Ruimte; a write that names an older revision is a `rev-conflict`. */
const RevisionSchema = z.number().int().nonnegative();

export const PersonalTemplatesSchema = z.object({
    revision: RevisionSchema,
    live: z.array(LiveTemplateSchema),
    postfix: z.array(PostfixTemplateSchema),
    // Ids of built-in templates a person switched off.
    disabled: z.array(z.string()),
    settings: TemplateSettingsSchema
});
export type PersonalTemplates = z.infer<typeof PersonalTemplatesSchema>;

export const ProjectTemplatesSchema = z.object({
    revision: RevisionSchema,
    live: z.array(LiveTemplateSchema),
    postfix: z.array(PostfixTemplateSchema)
});
export type ProjectTemplates = z.infer<typeof ProjectTemplatesSchema>;

export const TemplateListPayloadSchema = z.object({ projectId: ProjectIdSchema.optional() });

/*
 * `project` is null without a `projectId`, and for a project this client does not hold. It is null as well
 * when the project's file is from a newer Ruimte, which `projectTooNew` says, or is JSON that breaks the
 * schema, which `projectInvalid` says; the person's own templates still come through.
 */
export const TemplateListResultSchema = z.object({
    personal: PersonalTemplatesSchema,
    project: ProjectTemplatesSchema.nullable(),
    projectTooNew: z.literal(true).optional(),
    projectInvalid: z.literal(true).optional()
});
export type TemplateListResult = z.infer<typeof TemplateListResultSchema>;

const TemplateWriteShape = {
    scope: TemplateScopeSchema,
    // Required for the `project` scope.
    projectId: ProjectIdSchema.optional(),
    revision: RevisionSchema
};

/* A new template, or a change of one by its id. */
export const TemplateSavePayloadSchema = z.discriminatedUnion('kind', [
    z.object({ ...TemplateWriteShape, kind: z.literal('live'), template: LiveTemplateInputSchema }),
    z.object({ ...TemplateWriteShape, kind: z.literal('postfix'), template: PostfixTemplateInputSchema })
]);
export type TemplateSavePayload = z.infer<typeof TemplateSavePayloadSchema>;

export const TemplateSaveResultSchema = z.discriminatedUnion('kind', [
    z.object({ revision: RevisionSchema, kind: z.literal('live'), template: LiveTemplateSchema }),
    z.object({ revision: RevisionSchema, kind: z.literal('postfix'), template: PostfixTemplateSchema })
]);
export type TemplateSaveResult = z.infer<typeof TemplateSaveResultSchema>;

export const TemplateRemovePayloadSchema = z.object({
    ...TemplateWriteShape,
    kind: TemplateKindSchema,
    id: z.string().min(1)
});
export type TemplateRemovePayload = z.infer<typeof TemplateRemovePayloadSchema>;

export const TemplateRemoveResultSchema = z.object({ revision: RevisionSchema });
export type TemplateRemoveResult = z.infer<typeof TemplateRemoveResultSchema>;

/* Which built-in templates are off, replaced as a list, and the switches of the editor, each key changed only when named. */
export const TemplateConfigurePayloadSchema = z.object({
    revision: RevisionSchema,
    disabled: z.array(z.string().min(1)).optional(),
    settings: TemplateSettingsSchema.optional()
});
export type TemplateConfigurePayload = z.infer<typeof TemplateConfigurePayloadSchema>;

export const TemplateConfigureResultSchema = z.object({
    revision: RevisionSchema,
    disabled: z.array(z.string()),
    settings: TemplateSettingsSchema
});
export type TemplateConfigureResult = z.infer<typeof TemplateConfigureResultSchema>;

/* To every client for a person's templates, to the clients that hold the project for a project's. */
export const TemplateChangedEventSchema = z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('personal'), snapshot: PersonalTemplatesSchema }),
    z.object({ scope: z.literal('project'), projectId: ProjectIdSchema, snapshot: ProjectTemplatesSchema })
]);
export type TemplateChangedEvent = z.infer<typeof TemplateChangedEventSchema>;

/*
 * Both files read loose, so a key a later release adds survives a write of this one. The entries stay
 * unread here and are checked one by one, so one this release cannot read is kept as it stands.
 */
export const PersonalTemplatesFileSchema = z.looseObject({
    version: z.number().int().positive(),
    live: z.array(z.unknown()).optional(),
    postfix: z.array(z.unknown()).optional(),
    disabled: z.array(z.string()).optional(),
    settings: z.looseObject({}).optional()
});

export const ProjectTemplatesFileSchema = z.looseObject({
    version: z.number().int().positive(),
    live: z.array(z.unknown()).optional(),
    postfix: z.array(z.unknown()).optional()
});

export const TEMPLATES_REQUEST_SCHEMAS = {
    // Any client of the owner edits; no request of these is on a peer's list, and an agent reaches templates only through its verb.
    'template.list': { payload: TemplateListPayloadSchema, result: TemplateListResultSchema },
    'template.save': { payload: TemplateSavePayloadSchema, result: TemplateSaveResultSchema },
    'template.remove': { payload: TemplateRemovePayloadSchema, result: TemplateRemoveResultSchema },
    'template.configure': { payload: TemplateConfigurePayloadSchema, result: TemplateConfigureResultSchema }
} as const;

export const TEMPLATES_EVENT_SCHEMAS = {
    // A person's templates to every client, a project's to the clients that hold it.
    'template.changed': TemplateChangedEventSchema
} as const;
