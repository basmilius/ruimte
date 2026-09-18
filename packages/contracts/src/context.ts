import { z } from 'zod';
import { DeviceReferenceSchema } from './device.ts';

// What an edge into an agent node makes readable to that agent.
export const ContextSourceSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['text', 'terminal', 'chat', 'browser', 'device', 'drawing', 'diagram', 'file']),
    title: z.string(),
    /* A text element carries its own content, a file carries its path (absolute on the daemon's
       machine) and a browser its address. A terminal, a chat, a drawing, a diagram and the page
       under a browser are read live from the daemon instead. */
    text: z.string().optional(),
    /* The node a drawing or a diagram is linked through, whose id is what `node list` and `link list` show,
       so `read` takes it beside the view id. */
    nodeId: z.string().min(1).optional(),
    /* Which device a device node points at. It travels with the source because only the machine
       knows which devices it really has, and that answer is worth nothing until the moment of asking. */
    device: DeviceReferenceSchema.optional()
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;
