import { z } from 'zod';
import { DeviceReferenceSchema } from './device.ts';

// What an edge into an agent node makes readable to that agent.
export const ContextSourceSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['text', 'terminal', 'chat', 'browser', 'device', 'drawing', 'diagram', 'file', 'artifact', 'routine', 'extension']),
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
    device: DeviceReferenceSchema.optional(),
    // The flag the person put on the node or view, as a node accent name.
    flag: z.string().optional(),
    /* What an artifact node shows of the machine's Output; read when it is asked for, only within the node's own project. */
    artifact: z.object({ id: z.string().min(1), version: z.string().min(1).optional() }).optional(),
    // The routine a routine node names, read when it is asked for, only within the node's own project.
    routine: z.string().min(1).optional(),
    // Which extension's node this is, whose own `server/` says what it holds when it is read.
    extension: z.object({ id: z.string().min(1), type: z.string().min(1), data: z.unknown() }).optional()
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;

/*
 * The usage counter of every toolkit, named after the `ruimte-context` command it replaced, and `help`, which only that CLI had.
 * A client draws a tool call and an old chat's CLI call by it; the daemon's toolkits are the source and a test holds this list to them.
 */
export const CONTEXT_VERBS = [
    'help',
    'list',
    'read',
    'done',
    'notify',
    'alert',
    'answer',
    'agent',
    'team',
    'fork',
    'flag',
    'node',
    'link',
    'browser',
    'device',
    'view',
    'task',
    'plan',
    'visual',
    'artifact',
    'chat',
    'ui',
    'worktree',
    'operation',
    'tool',
    'launches',
    'routine',
    'secret',
    'project',
    'database',
    'language',
    'template',
    'provider',
    'computer'
] as const;
export type ContextVerb = (typeof CONTEXT_VERBS)[number];
