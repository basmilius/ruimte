import { z } from 'zod';

// What an edge into an agent node makes readable to that agent.
export const ContextSourceSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['text', 'terminal', 'chat', 'drawing', 'file']),
    title: z.string(),
    /* A text element carries its own content, and a file carries its path (absolute on the daemon's
       machine). A terminal, a chat and a drawing are read live from the daemon instead. */
    text: z.string().optional()
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;
