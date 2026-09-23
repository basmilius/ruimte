import { randomBytes } from 'node:crypto';
import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import { NODE_SIZE, type AgentKind, type ModelSelection, type ProjectEdge, type ProjectNode, type RuntimeMode } from '@ruimte/contracts';
import { agentNode, groupLines, grownGroup, readsOf, requireInstalled, startPrompt, terminalMode } from '../canvas/agents.ts';
import { depthForOpening } from '../canvas/depth.ts';
import { modeForOpening } from '../canvas/mode.ts';
import { selectionForOpening } from '../canvas/model.ts';
import { MAX_CANVAS_NODES, canvasFull, newId, nodeLines, nodesNamed } from '../canvas/nodes.ts';
import { refuseMissingNodes } from '../canvas/own-view.ts';
import { groupMembers, placeBeside, placeFree, placeInGroup, placeTeam } from '../canvas/placement.ts';
import { checkCwd } from '../canvas/project-paths.ts';
import { MAX_TASK_PROMPT_LENGTH, requireChatParent, taskBrief } from '../canvas/tasks.ts';
import { NEW_NODE, OPENING_OFF_CANVAS, VerbRefusal, canvasFor, field, newNode } from '../canvas/verb.ts';
import { branchSlug, branchesForWorktrees, freeBranch, makeWorktrees } from '../canvas/worktree.ts';
import { providerFor } from '../providers/registry.ts';
import { verbCallOf, type ServerActionContext } from './context.ts';
import { operationIdOf } from './operation-actions.ts';

type TeamRole = { provider: AgentKind; terminal: boolean };

const kindOf = (role: TeamRole): 'chat' | 'terminal' => (!role.terminal && providerFor(role.provider).capabilities.chat ? 'chat' : 'terminal');

/*
 * Everything a start enforces lives here, whoever asks: the depth and the count of agents a caller
 * may open, a mode no wider than the caller's riding on every start, a directory inside the project
 * or its worktrees, and the task only a chat may give.
 */
export const startActions: ActionHandlers<ServerActionContext> = {
    'agent.start': async (input, call) => {
        const { context, dryRun = false } = call;
        const { host, place } = context;
        const caller = verbCallOf(call);
        const kind = input.provider;
        const depth = depthForOpening(caller, 'agent', 1);
        const ceiling = modeForOpening(caller, input.mode ?? undefined);
        const chat = !input.terminal && providerFor(kind).capabilities.chat;
        const selection = selectionForOpening(kind, chat, input.model ?? undefined);
        if (input.branch !== null && !input.worktree) {
            throw new VerbRefusal('branch-needs-worktree', '--branch names the branch of a worktree; add --worktree');
        }
        if (input.worktree && input.cwd !== null) {
            throw new VerbRefusal('worktree-and-cwd', '--worktree and --cwd both say where the agent starts; give one of them');
        }
        if (input.beside !== null && input.group !== null) {
            throw new VerbRefusal('two-places', '--beside and --group both say where the node goes; give one of them');
        }
        const readIds = readsOf(input.reads);
        requireInstalled(await host.installedAgents(), kind);

        // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
        const prompt = await startPrompt(input.prompt, input.promptFile, host, place.folder);
        if (input.task !== null && prompt === null) {
            throw new VerbRefusal('task-needs-prompt', '--task gives a task and the prompt is what it asks; add --prompt or --prompt-file');
        }
        if (input.task !== null && prompt !== null && prompt.length > MAX_TASK_PROMPT_LENGTH) {
            throw new VerbRefusal(
                'prompt-too-long',
                `The prompt is ${prompt.length} characters and a task takes at most ${MAX_TASK_PROMPT_LENGTH}, since the child is also told how to report back; put the rest in a file and tell the agent to read it`
            );
        }
        let cwd = input.cwd === null ? undefined : await checkCwd(place.folder, input.cwd, (folder) => host.worktreePaths(folder));
        const runtimeMode = chat ? (input.mode ?? undefined) : terminalMode(caller, input.mode ?? undefined, ceiling);
        let undoWorktrees = async (): Promise<void> => undefined;
        if (input.worktree) {
            const branches = await branchesForWorktrees(caller, place.folder);
            const branch = input.branch ?? freeBranch(branchSlug(input.task ?? input.title ?? kind), branches);
            if (!dryRun) {
                const made = await makeWorktrees(caller, { folder: place.folder, projectId: place.projectId }, [branch]);
                cwd = made.worktrees[0]!.path;
                undoWorktrees = made.undo;
            }
        }

        return host
            .mutate<{ output: ActionOutput<'agent.start'>; operation?: { id: string; status: 'running' } }>(place.projectId, async (content) => {
                if (input.task !== null) {
                    requireChatParent(content, caller.caller);
                }
                const canvas = canvasFor(content, place, input.viewId ?? undefined, OPENING_OFF_CANVAS);
                if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                    throw canvasFull(canvas, 1);
                }
                const anchor = input.beside === null ? undefined : canvas.nodes.find((node) => node.id === input.beside);
                if (input.beside !== null && !anchor) {
                    throw refuseMissingNodes(content, [input.beside], canvas.id, 'the agent this opens has nothing there to stand beside', nodeLines(canvas));
                }
                const group = input.group === null ? undefined : canvas.nodes.find((node) => node.id === input.group && node.kind === 'group');
                if (input.group !== null && !group) {
                    throw new VerbRefusal('unknown-group', `${input.group} is not a group on ${canvas.id}`, groupLines(canvas));
                }
                const read = nodesNamed(content, canvas, readIds, { cannot: 'no line can run from it into the agent this opens' });

                const size = NODE_SIZE[chat ? 'chat' : 'terminal'];
                const self = canvas.nodes.find((node) => node.id === caller.caller) ?? null;
                const inGroup = group ? placeInGroup(group, groupMembers(group, canvas.nodes), size) : null;
                const rect = inGroup?.rect ?? (anchor ? placeBeside(anchor, size) : placeFree(canvas.nodes, size, self));
                const kindName = chat ? ('chat' as const) : ('terminal' as const);

                if (dryRun) {
                    return {
                        content: null,
                        result: {
                            output: {
                                nodeId: NEW_NODE,
                                kind: kindName,
                                viewId: canvas.id,
                                provider: kind,
                                edge: self ? { edgeId: null, from: self.id, to: NEW_NODE } : null,
                                reads: read.map((node) => ({ edgeId: null, from: node.id, to: NEW_NODE })),
                                taskId: null
                            }
                        }
                    };
                }

                const id = newId(kindName, content);
                const taken = [id];
                const mint = (): string => {
                    const fresh = newId('edge', content, taken);
                    taken.push(fresh);
                    return fresh;
                };
                const node = agentNode({
                    id,
                    chat,
                    kind,
                    title: input.title ?? input.task ?? undefined,
                    rect,
                    cwd,
                    ...(runtimeMode === undefined ? {} : { runtimeMode })
                });
                const edge: ProjectEdge | null = self ? { id: mint(), from: self.id, to: id, label: 'context' } : null;
                const reading: ProjectEdge[] = [];
                const readLines = read.map((source) => {
                    /* Your own line is the one drawn above: naming yourself in --reads is that line
                       reported again, never a second one beside it. */
                    const line = edge && edge.from === source.id ? edge : { id: mint(), from: source.id, to: id, label: 'context' };
                    if (line !== edge) {
                        reading.push(line);
                    }
                    return { edgeId: line.id, from: source.id, to: id };
                });
                const nodes = [...canvas.nodes.map((candidate) => (group && candidate.id === group.id ? grownGroup(candidate, inGroup, id) : candidate)), node];
                const output: ActionOutput<'agent.start'> = {
                    nodeId: id,
                    kind: kindName,
                    viewId: canvas.id,
                    provider: kind,
                    edge: edge ? { edgeId: edge.id, from: edge.from, to: edge.to } : null,
                    reads: readLines,
                    taskId: null
                };

                return {
                    landed: async () => {
                        await host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: caller.caller, depth, agent: true });
                        if (input.worktree && cwd !== undefined) {
                            await host.claimWorktree(place.folder, cwd, id);
                        }
                        // Before the agent starts, so a child that is done at once finds its task open.
                        if (input.task !== null && prompt !== null) {
                            const task = await host.tasks.open({
                                projectId: place.projectId,
                                parentId: caller.caller,
                                childId: id,
                                title: input.task,
                                prompt
                            });
                            output.taskId = task.id;
                        }
                        if (prompt !== null) {
                            await host.holdPrompt(place.projectId, id, input.task === null ? prompt : `${prompt}${taskBrief(chat)}`);
                        }
                        await host.startAgent({
                            projectId: place.projectId,
                            nodeId: id,
                            openedBy: caller.caller,
                            node: kindName,
                            provider: kind,
                            ...(selection ? { selection } : {}),
                            cwd: cwd ?? place.folder,
                            ...(runtimeMode === undefined ? {} : { runtimeMode })
                        });
                    },
                    content: {
                        ...content,
                        views: content.views.map((view) =>
                            view.id === canvas.id ? { ...canvas, nodes, edges: [...canvas.edges, ...(edge ? [edge] : []), ...reading] } : view
                        )
                    },
                    // Started is not done: the outbox starts the agent, and its task or its first turn says how it went.
                    result: { output, operation: { id: operationIdOf('agent.start', [id]), status: 'running' } }
                };
            })
            .catch(async (e: unknown) => {
                await undoWorktrees();
                throw e;
            });
    },
    'team.start': async (input, call) => {
        const { context, dryRun = false } = call;
        const { host, place } = context;
        const caller = verbCallOf(call);
        const { roles } = input;
        const selections = roles.map((role, index): ModelSelection | undefined => {
            try {
                return selectionForOpening(role.provider, kindOf(role) === 'chat', role.model ?? undefined);
            } catch (e) {
                if (e instanceof VerbRefusal) {
                    throw new VerbRefusal(e.code, `role ${index} (model): ${e.message}`, e.lines);
                }
                throw e;
            }
        });
        const long = input.task ? roles.findIndex((role) => role.prompt.length > MAX_TASK_PROMPT_LENGTH) : -1;
        if (long !== -1) {
            throw new VerbRefusal(
                'prompt-too-long',
                `role ${long} (prompt): ${roles[long]!.prompt.length} characters, and a task takes at most ${MAX_TASK_PROMPT_LENGTH}, since the child is also told how to report back`
            );
        }
        const depth = depthForOpening(caller, 'team', roles.length);
        const ceiling = modeForOpening(caller, input.mode ?? undefined);
        const readIds = readsOf(input.reads);
        if (input.worktree && input.cwd !== null) {
            throw new VerbRefusal('worktree-and-cwd', '--worktree and --cwd both say where the agents start; give one of them');
        }

        const installed = await host.installedAgents();
        roles.forEach((role, index) => requireInstalled(installed, role.provider, `role ${index} (${role.provider})`));

        // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
        const cwd = input.cwd === null ? undefined : await checkCwd(place.folder, input.cwd, (folder) => host.worktreePaths(folder));
        const roleCwds: Array<string | undefined> = roles.map(() => cwd);
        let undoWorktrees = async (): Promise<void> => undefined;
        if (input.worktree) {
            const taken = await branchesForWorktrees(caller, place.folder);
            const branches = roles.map((role) => {
                const branch = freeBranch(branchSlug(role.title), taken);
                taken.add(branch);
                return branch;
            });
            if (!dryRun) {
                const made = await makeWorktrees(caller, { folder: place.folder, projectId: place.projectId }, branches);
                made.worktrees.forEach((worktree, index) => {
                    roleCwds[index] = worktree.path;
                });
                undoWorktrees = made.undo;
            }
        }
        const modes: Array<RuntimeMode | undefined> = roles.map((role) =>
            kindOf(role) === 'chat' ? (input.mode ?? undefined) : terminalMode(caller, input.mode ?? undefined, ceiling)
        );

        return host
            .mutate<{ output: ActionOutput<'team.start'>; operation?: { id: string; status: 'running' } }>(place.projectId, async (content) => {
                if (input.task) {
                    requireChatParent(content, caller.caller);
                }
                const canvas = canvasFor(content, place, input.viewId ?? undefined, OPENING_OFF_CANVAS);
                // The group counts too, which is the one node a caller does not name in its roles.
                if (canvas.nodes.length + roles.length + 1 > MAX_CANVAS_NODES) {
                    throw canvasFull(canvas, roles.length + 1);
                }

                const read = nodesNamed(content, canvas, readIds, { cannot: 'no line can run from it into the agents this opens' });
                const layout = placeTeam(roles.map((role) => NODE_SIZE[kindOf(role)]));
                const self = canvas.nodes.find((node) => node.id === caller.caller) ?? null;
                const origin = placeFree(canvas.nodes, layout.frame, self);

                if (dryRun) {
                    // The role rather than a placeholder every row would share: the plan is what to read before anything is made.
                    const placeholders = roles.map((role) => newNode(field(role.title)));
                    return {
                        content: null,
                        result: {
                            output: {
                                group: { nodeId: NEW_NODE, title: input.label, viewId: canvas.id },
                                agents: roles.map((role, index) => ({
                                    nodeId: placeholders[index]!,
                                    kind: kindOf(role),
                                    title: role.title,
                                    provider: role.provider,
                                    edge: self ? { edgeId: null, from: self.id, to: placeholders[index]! } : null,
                                    taskId: null
                                })),
                                reads: placeholders.flatMap((placeholder) => read.map((node) => ({ edgeId: null, from: node.id, to: placeholder })))
                            }
                        }
                    };
                }

                const taken: string[] = [];
                const mint = (prefix: string): string => {
                    const id = newId(prefix, content, taken);
                    taken.push(id);
                    return id;
                };

                /* A group that is not collapsed holds whatever has its center inside the frame, the same
                   rule the client reads membership by, so there is no memberIds to fill in here. */
                const groupId = mint('group');
                const group: ProjectNode = { id: groupId, kind: 'group', title: input.label, ...origin };
                const nodes: ProjectNode[] = [group];
                const edges: ProjectEdge[] = [];
                const output: ActionOutput<'team.start'> = { group: { nodeId: groupId, title: input.label, viewId: canvas.id }, agents: [], reads: [] };

                for (const [index, role] of roles.entries()) {
                    const chat = kindOf(role) === 'chat';
                    const rect = layout.rects[index]!;
                    const id = mint(chat ? 'chat' : 'terminal');
                    nodes.push(
                        agentNode({
                            id,
                            chat,
                            kind: role.provider,
                            title: role.title,
                            rect: { ...rect, x: origin.x + rect.x, y: origin.y + rect.y },
                            cwd: roleCwds[index],
                            ...(modes[index] === undefined ? {} : { runtimeMode: modes[index] })
                        })
                    );
                    let edge: ProjectEdge | null = null;
                    if (self) {
                        edge = { id: mint('edge'), from: self.id, to: id, label: 'context' };
                        edges.push(edge);
                    }
                    for (const source of read) {
                        /* Your own line is the one every role already gets: naming yourself in --reads
                           is that line reported again, never a second one beside it. */
                        if (edge && source.id === edge.from) {
                            output.reads.push({ edgeId: edge.id, from: source.id, to: id });
                            continue;
                        }
                        const readEdge = { id: mint('edge'), from: source.id, to: id, label: 'context' };
                        edges.push(readEdge);
                        output.reads.push({ edgeId: readEdge.id, from: source.id, to: id });
                    }
                    output.agents.push({
                        nodeId: id,
                        kind: chat ? 'chat' : 'terminal',
                        title: role.title,
                        provider: role.provider,
                        edge: edge ? { edgeId: edge.id, from: edge.from, to: edge.to } : null,
                        taskId: null
                    });
                }

                return {
                    landed: async () => {
                        const batchId = input.task ? `batch-${randomBytes(6).toString('hex')}` : undefined;
                        // Every task before any agent starts, so a role that is done at once never finds its team complete without the others.
                        for (const [index, made] of output.agents.entries()) {
                            await host.recordMade({ projectId: place.projectId, nodeId: made.nodeId, openedBy: caller.caller, depth, agent: true });
                            const roleCwd = roleCwds[index];
                            if (input.worktree && roleCwd !== undefined) {
                                await host.claimWorktree(place.folder, roleCwd, made.nodeId);
                            }
                            if (batchId !== undefined) {
                                const task = await host.tasks.open({
                                    projectId: place.projectId,
                                    parentId: caller.caller,
                                    childId: made.nodeId,
                                    title: made.title,
                                    prompt: roles[index]!.prompt,
                                    batchId
                                });
                                made.taskId = task.id;
                            }
                        }
                        for (const [index, made] of output.agents.entries()) {
                            const chat = made.kind === 'chat';
                            const prompt = roles[index]!.prompt;
                            await host.holdPrompt(place.projectId, made.nodeId, input.task ? `${prompt}${taskBrief(chat)}` : prompt);
                            await host.startAgent({
                                projectId: place.projectId,
                                nodeId: made.nodeId,
                                openedBy: caller.caller,
                                node: made.kind,
                                provider: made.provider,
                                ...(selections[index] ? { selection: selections[index] } : {}),
                                cwd: roleCwds[index] ?? place.folder,
                                ...(modes[index] === undefined ? {} : { runtimeMode: modes[index] })
                            });
                        }
                    },
                    content: {
                        ...content,
                        views: content.views.map((view) =>
                            view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] } : view
                        )
                    },
                    result: {
                        output,
                        operation: {
                            id: operationIdOf(
                                'team.start',
                                output.agents.map((made) => made.nodeId)
                            ),
                            status: 'running'
                        }
                    }
                };
            })
            .catch(async (e: unknown) => {
                await undoWorktrees();
                throw e;
            });
    }
};
