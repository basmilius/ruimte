import { z } from 'zod';

const repositoryArgs = z.object({ repo: z.string().min(1).max(4096).default('.') }).strict();

/* The arguments of every live data source a UI block reads, which the sources parse and the agent note lists. */
export const UI_SOURCE_ARGS = {
    'git.status': repositoryArgs,
    'git.log': repositoryArgs.extend({ limit: z.number().int().min(1).max(60).default(30) }),
    'launch.status': z.object({ name: z.string().min(1).max(256) }).strict(),
    'chat.tasks': z.object({}).strict(),
    'database.query': z
        .object({
            connection: z.string().min(1).max(256),
            sql: z.string().min(1).max(16384),
            schema: z.string().min(1).max(256).nullable().default(null),
            limit: z.number().int().min(1).max(100).default(50)
        })
        .strict()
};

export type UiSourceName = keyof typeof UI_SOURCE_ARGS;

/* A source's arguments as a block writes them: each default as it is, and a placeholder where the agent fills one in. */
function exampleArgs(schema: z.ZodObject): string {
    const fields = Object.entries(schema.shape).map(([key, field]) => {
        const fallback = (field as z.ZodType).safeParse(undefined);
        return `${key}: ${fallback.success ? JSON.stringify(fallback.data) : JSON.stringify(`<${key}>`)}`;
    });
    return `{${fields.join(', ')}}`;
}

/* Every source a block in this chat may read, with its arguments; database.query only in a project with connections. */
export function uiSourceExamples(databases: boolean): { name: UiSourceName; args: string }[] {
    return (Object.entries(UI_SOURCE_ARGS) as [UiSourceName, z.ZodObject][])
        .filter(([name]) => databases || name !== 'database.query')
        .map(([name, schema]) => ({ name, args: exampleArgs(schema) }));
}
