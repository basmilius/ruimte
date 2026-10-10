import { z } from 'zod';
import { DatabaseAgentAccessSchema } from '@ruimte/contracts';

export const UiSourceAccessSchema = z.object({
    projectId: z.string(),
    folder: z.string(),
    cwd: z.string(),
    roots: z.array(z.string()),
    databases: z.array(z.object({ id: z.string(), target: z.string(), access: DatabaseAgentAccessSchema }))
});
