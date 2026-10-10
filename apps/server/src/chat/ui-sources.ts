import { UiSourceAccessSchema } from './ui-access.ts';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ChatInfo, Task } from '@ruimte/contracts';
import { GitLogResultSchema, GitStatusSchema, TaskSchema } from '@ruimte/contracts';
import type { ChatUiHost, ChatUiSource } from '@adecore/agents/chat/ui-queries';
import { ChatError } from './errors.ts';
import { checkCwd, isInside } from '../canvas/project-paths.ts';
import type { AgentDatabases, DatabasePlace } from '../database/agent-databases.ts';
import { resolveUiProjectLink } from './ui-links.ts';
import type { LaunchReading } from '../canvas/verb.ts';

export interface UiSourceHosts {
    place(chatId: string): DatabasePlace | null;
    // `hidden` for an agent that works out of sight, with no node or view to open.
    node(id: string): { projectId: string; title: string; canvasId: string | null; hidden: boolean } | null;
    worktreePaths(folder: string): Promise<string[]>;
    gitStatus(cwd: string): Promise<z.infer<typeof GitStatusSchema>>;
    gitLog(cwd: string, limit: number): Promise<z.infer<typeof GitLogResultSchema>>;
    launches(projectId: string): Promise<LaunchReading[]>;
    tasks(chatId: string): Task[];
    databases(): Pick<AgentDatabases, 'captureUiAccess' | 'authorizeUiRead' | 'query'>;
}

export function ruimteUiSources(host: UiSourceHosts): ChatUiHost {
    const place = (info: ChatInfo): DatabasePlace => {
        const current = host.place(info.chatId);
        if (!current) {
            throw new ChatError('refused-query', 'This chat is no longer in a project.');
        }
        return current;
    };
    const authorize = async (info: ChatInfo, input: unknown) => {
        const access = UiSourceAccessSchema.parse(input);
        const current = place(info);
        if (current.projectId !== access.projectId || (await realpath(current.folder)) !== access.folder) {
            throw new ChatError('refused-query', 'The query belongs to another project.');
        }
        return access;
    };
    const repository = async (info: ChatInfo, input: unknown, args: Record<string, unknown>) => {
        const access = await authorize(info, input);
        const cwd = await checkCwd(place(info).folder, resolve(access.cwd, String(args.repo ?? '.')), host.worktreePaths);
        const real = await realpath(cwd);
        if (!access.roots.some((root) => isInside(root, real))) {
            throw new ChatError('refused-query', 'This repository was outside the writer’s project.');
        }
        return cwd;
    };
    const repositoryArgs = z.object({ repo: z.string().min(1).max(4096).default('.') }).strict();
    const source = (definition: ChatUiSource): ChatUiSource => definition;
    const sources: Record<string, ChatUiSource> = {
        'git.status': source({
            args: repositoryArgs,
            result: GitStatusSchema,
            authorize: async (info, access, args) => {
                await repository(info, access, args);
            },
            read: async (info, args, _signal, access) => {
                return host.gitStatus(await repository(info, access, args));
            }
        }),
        'git.log': source({
            args: repositoryArgs.extend({ limit: z.number().int().min(1).max(60).default(30) }),
            result: GitLogResultSchema,
            authorize: async (info, access, args) => {
                await repository(info, access, args);
            },
            read: async (info, args, _signal, access) => {
                return host.gitLog(await repository(info, access, args), Number(args.limit));
            }
        }),
        'launch.status': source({
            args: z.object({ name: z.string().min(1).max(256) }).strict(),
            result: z.object({
                name: z.string(),
                launchId: z.string(),
                state: z.enum(['unstarted', 'starting', 'running', 'stopping', 'exited']),
                port: z.number().int().nullable(),
                url: z.string().nullable(),
                exitCode: z.number().int().nullable()
            }),
            authorize: async (info, access) => {
                await authorize(info, access);
            },
            read: async (info, args) => {
                const launches = await host.launches(place(info).projectId);
                const exact = launches.find((launch) => launch.launchId === args.name);
                const named = launches.filter((launch) => launch.name.toLowerCase() === String(args.name).toLowerCase());
                const launch = exact ?? (named.length === 1 ? named[0] : undefined);
                if (!launch) {
                    throw new Error('This project has no unique launch with that name.');
                }
                return {
                    name: launch.name,
                    launchId: launch.launchId,
                    state: launch.status?.state ?? 'unstarted',
                    port: launch.port,
                    url: launch.url,
                    exitCode: launch.status?.exitCode ?? null
                };
            }
        }),
        'chat.tasks': source({
            args: z.object({}).strict(),
            result: z.array(TaskSchema.pick({ id: true, childId: true, title: true, status: true, createdAt: true, settledAt: true })).max(100),
            authorize: async (info, access) => {
                await authorize(info, access);
            },
            read: async (info) =>
                host
                    .tasks(info.chatId)
                    .slice(-100)
                    .map(({ id, childId, title, status, createdAt, settledAt }) => ({ id, childId, title, status, createdAt, settledAt }))
        }),
        'database.query': source({
            args: z
                .object({
                    connection: z.string().min(1).max(256),
                    sql: z.string().min(1).max(16384),
                    schema: z.string().min(1).max(256).nullable().default(null),
                    limit: z.number().int().min(1).max(100).default(50)
                })
                .strict(),
            result: z.object({
                connection: z.string(),
                schema: z.string().nullable(),
                columns: z.array(z.string()),
                rows: z.array(z.record(z.string(), z.unknown())).max(100),
                hasMore: z.boolean(),
                elapsedMs: z.number()
            }),
            authorize: async (info, input, args) => {
                const access = await authorize(info, input);
                await host.databases().authorizeUiRead(place(info), String(args.connection), access.databases);
            },
            read: async (info, args, signal, input) => {
                const access = UiSourceAccessSchema.parse(input);
                const answer = await host.databases().query(place(info), info.chatId, String(args.connection), String(args.sql), {
                    schema: args.schema as string | null,
                    limit: Number(args.limit),
                    signal,
                    uiAccess: access.databases
                });
                const used = new Set<string>();
                const columns = answer.result.columns.map((column) => {
                    let name = column.name;
                    for (let suffix = 2; used.has(name); suffix++) {
                        name = `${column.name}_${suffix}`;
                    }
                    used.add(name);
                    return name;
                });
                return {
                    connection: answer.connection,
                    schema: answer.schema,
                    columns,
                    rows: answer.result.rows.map((row) => Object.fromEntries(columns.map((key, index) => [key, row[index] ?? null]))),
                    hasMore: answer.result.hasMore,
                    elapsedMs: answer.result.elapsedMs
                };
            }
        })
    };
    async function capturePlace(info: ChatInfo, current: DatabasePlace) {
        const [folder, cwd, trees] = await Promise.all([realpath(current.folder), realpath(info.cwd), host.worktreePaths(current.folder)]);
        const roots = [folder, ...(await Promise.all(trees.map((tree) => realpath(tree).catch(() => null)))).filter((tree): tree is string => tree !== null)];
        if (!roots.some((root) => isInside(root, cwd))) {
            throw new ChatError('refused-query', 'The writing chat is outside its project.');
        }
        return { projectId: current.projectId, folder, cwd, roots, databases: [] };
    }
    return {
        sources,
        link: (info, access, target) => resolveUiProjectLink(host, info, access, target),
        capture: async (info) => {
            const current = place(info);
            const [access, databases] = await Promise.all([capturePlace(info, current), host.databases().captureUiAccess(current)]);
            return { ...access, databases };
        }
    };
}
