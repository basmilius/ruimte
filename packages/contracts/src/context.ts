import { z } from 'zod';

// What an edge into an agent node makes readable to that agent.
export const ContextSourceSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['text', 'terminal', 'chat', 'drawing', 'diagram', 'file']),
    title: z.string(),
    /* A text element carries its own content, and a file carries its path (absolute on the daemon's
       machine). A terminal, a chat, a drawing and a diagram are read live from the daemon instead. */
    text: z.string().optional(),
    /* The node a drawing or a diagram is linked through, whose id is what `nodes` and `edges` show,
       so `read` takes it beside the view id. */
    nodeId: z.string().min(1).optional()
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;
