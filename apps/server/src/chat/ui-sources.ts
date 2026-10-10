import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ChatInfo, GitFileState, GitLogResult, GitStatus, Task } from '@ruimte/contracts';
import { GitFileSchema, GitFileStateSchema, GitLogResultSchema, GitOperationSchema, TaskSchema } from '@ruimte/contracts';
import type { ChatUiHost, ChatUiSource } from '@adecore/agents/chat/ui-queries';
import { checkCwd, isInside } from '../canvas/project-paths.ts';
import type { LaunchReading } from '../canvas/verb.ts';
import type { AgentDatabases, DatabasePlace } from '../database/agent-databases.ts';
import { ChatError } from './errors.ts';
import { UiSourceAccessSchema } from './ui-access.ts';
import { UI_SOURCE_ARGS } from './ui-source-args.ts';
import { resolveUiProjectLink } from './ui-links.ts';

export interface UiSourceHosts {
    place(chatId: string): DatabasePlace | null;
    // `hidden` for an agent that works out of sight, with no node or view to open.
    node(id: string): { projectId: string; title: string; canvasId: string | null; hidden: boolean } | null;
    worktreePaths(folder: string): Promise<string[]>;
    gitStatus(cwd: string): Promise<GitStatus>;
    gitLog(cwd: string, limit: number): Promise<GitLogResult>;
    launches(projectId: string): Promise<LaunchReading[]>;
    tasks(chatId: string): Task[];
    databases(): Pick<AgentDatabases, 'captureUiAccess' | 'authorizeUiRead' | 'query'>;
}

// A busy checkout lists thousands of files, and a reading stops at 64 KB.
const UI_STATUS_FILES = 50;

const UiGitStatusSchema = z.object({
    repo: z.boolean(),
    operation: GitOperationSchema.optional(),
    branch: z.string().nullable(),
    detached: z.boolean(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    counts: z.record(GitFileStateSchema, z.number().int().nonnegative()),
    files: z.array(GitFileSchema.pick({ path: true, state: true, status: true })).max(UI_STATUS_FILES),
    truncated: z.boolean()
});

/* The status a UI block reads: the branch, the counts per state and the first files, with `truncated` once any are left out. */
export function uiGitStatus(status: GitStatus): z.infer<typeof UiGitStatusSchema> {
    const count = (state: GitFileState) => status.files.filter((file) => file.state === state).length;
    return {
        repo: status.repo,
        ...(status.operation === undefined ? {} : { operation: status.operation }),
        branch: status.branch,
        detached: status.detached,
        upstream: status.upstream,
        ahead: status.ahead,
        behind: status.behind,
        counts: { staged: count('staged'), unstaged: count('unstaged'), untracked: count('untracked'), conflicted: count('conflicted') },
        files: status.files.slice(0, UI_STATUS_FILES).map(({ path, state, status: letter }) => ({ path, state, status: letter })),
        truncated: status.truncated || status.files.length > UI_STATUS_FILES
    };
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
            throw new ChatError('refused-query', 'This chat moved to another project since the agent wrote this.');
        }
        return access;
    };
    const repository = async (info: ChatInfo, input: unknown, args: Record<string, unknown>) => {
        const access = await authorize(info, input);
        const cwd = await checkCwd(place(info).folder, resolve(access.cwd, String(args.repo ?? '.')), host.worktreePaths);
        const real = await realpath(cwd);
        if (!access.roots.some((root) => isInside(root, real))) {
            throw new ChatError('refused-query', 'This repository is outside the project the agent wrote this in.');
        }
        return cwd;
    };
    const sources = {
        'git.status': {
            args: UI_SOURCE_ARGS['git.status'],
            result: UiGitStatusSchema,
            authorize: async (info, access, args) => {
                await repository(info, access, args);
            },
            read: async (info, args, _signal, access) => {
                return uiGitStatus(await host.gitStatus(await repository(info, access, args)));
            }
        },
        'git.log': {
            args: UI_SOURCE_ARGS['git.log'],
            result: GitLogResultSchema,
            authorize: async (info, access, args) => {
                await repository(info, access, args);
            },
            read: async (info, args, _signal, access) => {
                return host.gitLog(await repository(info, access, args), Number(args.limit));
            }
        },
        'launch.status': {
            args: UI_SOURCE_ARGS['launch.status'],
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
                    throw new ChatError('refused-query', 'This project has no unique launch with that name.');
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
        },
        'chat.tasks': {
            args: UI_SOURCE_ARGS['chat.tasks'],
            result: z.array(TaskSchema.pick({ id: true, childId: true, title: true, status: true, createdAt: true, settledAt: true })).max(100),
            authorize: async (info, access) => {
                await authorize(info, access);
            },
            read: async (info) =>
                host
                    .tasks(info.chatId)
                    .slice(-100)
                    .map(({ id, childId, title, status, createdAt, settledAt }) => ({ id, childId, title, status, createdAt, settledAt }))
        },
        'database.query': {
            args: UI_SOURCE_ARGS['database.query'],
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
        }
    } satisfies Record<string, ChatUiSource>;
    const capturePlace = async (info: ChatInfo, current: DatabasePlace) => {
        const [folder, cwd, trees] = await Promise.all([realpath(current.folder), realpath(info.cwd), host.worktreePaths(current.folder)]);
        const roots = [folder, ...(await Promise.all(trees.map((tree) => realpath(tree).catch(() => null)))).filter((tree): tree is string => tree !== null)];
        if (!roots.some((root) => isInside(root, cwd))) {
            throw new ChatError('refused-query', "The agent's chat is outside its project.");
        }
        return { projectId: current.projectId, folder, cwd, roots };
    };
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
