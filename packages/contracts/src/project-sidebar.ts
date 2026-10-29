import { z } from 'zod';
import { AgentKindSchema, AgentStatusSchema } from './agent.ts';
import { flagOf } from './project-flags.ts';
import {
    ProjectSummaryResultSchema,
    isCanvasView,
    isChatHostView,
    isDesignView,
    isSessionView,
    isUnlistedView,
    designNodeChats,
    sessionKindOfView,
    NodeTitleSourceSchema,
    ProjectIconChoiceSchema,
    ProjectSummarySchema,
    UNKNOWN_KIND,
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
    status: AgentStatusSchema.optional(),
    // A design's later chats, absent from older machines. Their statuses arrive under their own ids.
    chats: z.array(z.string()).optional()
});

export const ProjectSidebarViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    titleSource: NodeTitleSourceSchema.optional(),
    kind: z.enum(['canvas', 'terminal', 'chat', 'browser', 'device', 'drawing', 'diagram', 'file', 'database', 'separator', 'subheader', 'unknown']),
    icon: ProjectIconChoiceSchema.nullable(),
    provider: AgentKindSchema.nullable(),
    path: z.string().nullable(),
    shared: z.boolean(),
    // The flag this person put on the row, as a node accent name; absent from a daemon from before flags.
    flag: z.string().optional(),
    nodes: z.array(SidebarNodeSchema),
    self: SidebarNodeSchema.nullable(),
    // A design, which goes as an unknown row since the kinds are a closed list; absent from a daemon from before designs.
    design: z.boolean().optional()
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

/*
 * The name, color, icon or availability of a project changed; too small to ship a document for. A client
 * that does not hold the project hears no `project.changed`, so a change of its document reaches it here,
 * with the rows of its sidebar.
 */
export const ProjectSummaryEventSchema = ProjectSummaryResultSchema.extend({
    views: z.array(ProjectSidebarViewSchema).optional()
});
export type ProjectSummaryEvent = z.infer<typeof ProjectSummaryEventSchema>;

/* Keep canvas geometry, note text and embedded files off background sidebar requests. A chat nobody
   wrote in yet, a chat an inline edit runs in and a canvas kept for another machine are not listed, so the rows a client builds for its own project read the same. */
export function projectSidebarViews(views: readonly ProjectView[], shared: readonly string[], flags?: ProjectFlags): ProjectSidebarView[] {
    return views
        .filter((view): boolean => !isUnlistedView(view))
        .map((view) => {
            const provider = isChatHostView(view) || view.kind === 'terminal' ? (view.node.provider ?? null) : null;
            const flag = flagOf(flags, view.id);
            return {
                id: view.id,
                name: view.name ?? '',
                titleSource: 'titleSource' in view ? view.titleSource : undefined,
                // The row's kinds are a closed list on the wire, which an artifact view and a design join only as a row an older client can draw.
                kind: view.kind === 'artifact' || view.kind === 'design' ? UNKNOWN_KIND : view.kind,
                icon: viewIconOf(view),
                provider,
                path: view.kind === 'file' ? view.path : null,
                shared: shared.includes(view.id),
                ...(flag === null ? {} : { flag }),
                nodes: isCanvasView(view)
                    ? view.nodes.flatMap((node) =>
                          // A design node goes as the chat it is, since the kinds are a closed list on the wire.
                          node.kind === 'terminal' || node.kind === 'chat' || node.kind === 'design' || node.kind === 'browser' || node.kind === 'device'
                              ? [
                                    {
                                        id: node.id,
                                        title: node.title,
                                        titleSource: node.titleSource,
                                        kind: node.kind === 'design' ? ('chat' as const) : node.kind,
                                        provider: node.provider ?? null,
                                        ...(node.kind === 'design' ? { chats: designNodeChats(node).map((chat) => chat.id) } : {})
                                    }
                                ]
                              : []
                      )
                    : [],
                self: isSessionView(view)
                    ? {
                          id: view.id,
                          title: view.name,
                          titleSource: view.titleSource,
                          kind: sessionKindOfView(view),
                          provider,
                          ...(isDesignView(view) ? { chats: designNodeChats(view).map((chat) => chat.id) } : {})
                      }
                    : null,
                ...(isDesignView(view) ? { design: true } : {})
            };
        });
}
