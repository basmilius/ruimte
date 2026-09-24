import { z } from 'zod';
import { AgentKindSchema, AgentStatusSchema } from './agent.ts';
import { flagOf } from './project-flags.ts';
import {
    isCanvasView,
    isSessionView,
    NodeTitleSourceSchema,
    ProjectIconChoiceSchema,
    ProjectSummarySchema,
    viewIconOf,
    type ProjectFlags,
    type ProjectView
} from './project.ts';

const SidebarNodeSchema = z.object({
    id: z.string(),
    title: z.string(),
    titleSource: NodeTitleSourceSchema.optional(),
    kind: z.enum(['terminal', 'chat', 'browser', 'device']),
    provider: AgentKindSchema.nullable(),
    status: AgentStatusSchema.optional()
});

export const ProjectSidebarViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    titleSource: NodeTitleSourceSchema.optional(),
    kind: z.enum(['canvas', 'terminal', 'chat', 'browser', 'device', 'drawing', 'diagram', 'file', 'separator', 'subheader', 'unknown']),
    icon: ProjectIconChoiceSchema.nullable(),
    provider: AgentKindSchema.nullable(),
    path: z.string().nullable(),
    shared: z.boolean(),
    // The flag this person put on the row, as a node accent name; absent from a daemon from before flags.
    flag: z.string().optional(),
    nodes: z.array(SidebarNodeSchema),
    self: SidebarNodeSchema.nullable()
});

export const ProjectSidebarResultSchema = z.object({
    projects: z.array(
        z.object({
            summary: ProjectSummarySchema,
            views: z.array(ProjectSidebarViewSchema).nullable()
        })
    )
});

export type ProjectSidebarView = z.infer<typeof ProjectSidebarViewSchema>;
export type ProjectSidebarResult = z.infer<typeof ProjectSidebarResultSchema>;

// Keep canvas geometry, note text and embedded files off background sidebar requests.
export const projectSidebarViews = (views: readonly ProjectView[], shared: readonly string[], flags?: ProjectFlags): ProjectSidebarView[] =>
    views.map((view) => {
        const provider = view.kind === 'chat' || view.kind === 'terminal' ? (view.node.provider ?? null) : null;
        const flag = flagOf(flags, view.id);
        return {
            id: view.id,
            name: view.name ?? '',
            titleSource: 'titleSource' in view ? view.titleSource : undefined,
            kind: view.kind,
            icon: viewIconOf(view),
            provider,
            path: view.kind === 'file' ? view.path : null,
            shared: shared.includes(view.id),
            ...(flag === null ? {} : { flag }),
            nodes: isCanvasView(view)
                ? view.nodes.flatMap((node) =>
                      node.kind === 'terminal' || node.kind === 'chat' || node.kind === 'browser' || node.kind === 'device'
                          ? [{ id: node.id, title: node.title, titleSource: node.titleSource, kind: node.kind, provider: node.provider ?? null }]
                          : []
                  )
                : [],
            self: isSessionView(view) ? { id: view.id, title: view.name, titleSource: view.titleSource, kind: view.kind, provider } : null
        };
    });
