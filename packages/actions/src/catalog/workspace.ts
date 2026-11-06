import { AgentStatusSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { PERSON_AND_VOICE, ActionViewKindSchema, ActionCanvasNodeKindSchema, viewId, revision, CLIENT_ACTORS, TARGET_KINDS, resolvedTarget } from './fields.ts';

export const WORKSPACE_ACTIONS = {
    'workspace.inspect': {
        title: 'Inspect workspace',
        description: 'Reads the current project, active view, openable views, the cells of the split grid on screen, active canvas nodes and selection.',
        effect: 'read',
        domain: 'workspace',
        actors: CLIENT_ACTORS,
        input: z.object({}),
        output: z.object({
            project: z.string(),
            // Of the project file, as this window last saved or read it.
            revision,
            activeView: z
                .object({
                    id: viewId,
                    name: z.string(),
                    kind: ActionViewKindSchema
                })
                .nullable(),
            views: z.array(
                z.object({
                    id: viewId,
                    name: z.string(),
                    kind: ActionViewKindSchema
                })
            ),
            // Column by column, top to bottom; a cell is named by the view standing in it.
            cells: z.array(z.object({ viewId, view: z.string(), column: z.number().int(), cell: z.number().int(), focused: z.boolean() })),
            canvas: z
                .object({
                    viewId,
                    nodes: z.array(
                        z.object({
                            id: z.string().min(1),
                            title: z.string(),
                            kind: ActionCanvasNodeKindSchema,
                            visible: z.boolean(),
                            // What a chat or terminal agent does, where the machine answers rather than a window.
                            status: z.union([AgentStatusSchema, z.literal('unknown')]).optional()
                        })
                    ),
                    selected: z.array(
                        z.object({
                            id: z.string().min(1),
                            title: z.string(),
                            kind: ActionCanvasNodeKindSchema
                        })
                    )
                })
                .nullable(),
            /*
             * What this answer cannot know, so an empty list there reads as unknown and never as empty: the
             * machine answers for a phone, which has no split cells or selection and does not say what is in sight.
             */
            unknown: z.array(z.enum(['cells', 'selection', 'visible'])).optional()
        })
    },
    'target.resolve': {
        title: 'Resolve names',
        description:
            'Turns spoken or typed names of views, nodes on the active canvas, AI Chats, agents or projects (a project in use before one under Recent) into ids. A name that fits more than one comes back under ambiguous with every candidate, never as the first of them. Without names it returns the current ones: the active view, the nodes in scope (the selection unless a scope is given), the active or selected AI Chat, the selected agent or the active project. Scope and nodeKind narrow nodes, machine narrows projects.',
        effect: 'read',
        domain: 'workspace',
        actors: PERSON_AND_VOICE,
        input: z.object({
            target: z.enum(TARGET_KINDS),
            names: z.array(z.string().trim().min(1)).min(1).nullable(),
            nodeKind: ActionCanvasNodeKindSchema.nullable(),
            scope: z.enum(['selected', 'visible', 'all']).nullable(),
            machine: z.string().trim().min(1).nullable()
        }),
        output: z.object({
            target: z.enum(TARGET_KINDS),
            found: z.array(resolvedTarget),
            ambiguous: z.array(z.object({ name: z.string(), candidates: z.array(resolvedTarget) })),
            missing: z.array(z.string())
        })
    }
} as const;
