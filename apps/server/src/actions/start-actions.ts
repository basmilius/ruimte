import { randomBytes } from 'node:crypto';
import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import { withView, type AgentKind, type ModelSelection, type ProjectChatView, type ProjectEdge, type ProjectNode, type RuntimeMode } from '@ruimte/contracts';
import { agentNode, groupLines, grownGroup, inheritedAccount, nameOf, readsOf, requireInstalled, startPrompt, terminalMode } from '../canvas/agents.ts';
import { depthForOpening } from '../canvas/depth.ts';
import { modeForOpening } from '../canvas/mode.ts';
import { EFFORT_REFUSALS, selectionForOpening } from '../canvas/model.ts';
import { MAX_CANVAS_NODES, canvasFull, newId, nodeLines, nodesNamed } from '../canvas/nodes.ts';
import { refuseMissingNodes } from '../canvas/own-view.ts';
import { refuseRemoteStart, resolveMachine, sourceCheckout } from '../canvas/remote-agent.ts';
import { groupMembers, placeBeside, placeFree, placeInGroup, placeTeam } from '../canvas/placement.ts';
import { checkCwd } from '../canvas/project-paths.ts';
import { MAX_TASK_PROMPT_LENGTH, requireChatParent, taskFirstPrompt } from '../canvas/tasks.ts';
import type { FirstPrompt } from '../agents/pending-prompts.ts';
import { NEW_NODE, OPENING_OFF_CANVAS, VerbRefusal, canvasFor, canvasLines, field, newNode, type VerbCall, type WorktreeWant } from '../canvas/verb.ts';
import { reachedPlace } from '../canvas/reach.ts';
import { KeyedQueue } from '../keyed-queue.ts';
import { MAX_PROJECT_VIEWS } from '../canvas/views.ts';
import { branchSlug, makeWorktrees, requireRepository } from '../canvas/worktree.ts';
import { untrustedStartProblem } from '../peering/untrusted.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { providerFor } from '../providers/registry.ts';
import { verbCallOf, type ServerActionContext } from './context.ts';
import { startInputHash } from './start-claims.ts';
import { operationIdOf } from './operation-actions.ts';

type TeamRole = { provider: AgentKind; terminal: boolean };

function kindOf(role: TeamRole): 'chat' | 'terminal' {
    return !role.terminal && providerFor(role.provider).capabilities.chat ? 'chat' : 'terminal';
}

/*
 * An agent that came from another machine, or that stands in a folder made from its work, opens nothing
 * that would load the configuration of those files: the same refusals `peer.taskStart` gives.
 */
function refuseUntrustedStart(
    host: ServerActionContext['host'],
    callerId: string,
    cwd: string | undefined,
    agents: Array<{ provider: AgentKind; chat: boolean }>,
    folder?: string
): void {
    const { untrusted } = host;
    // Voice is no node and gives no cwd, so the folder its session works in is what is judged for it.
    const inUntrusted = (cwd !== undefined && untrusted?.inFolder(cwd) === true) || (folder !== undefined && untrusted?.inFolder(folder) === true);
    if (untrusted === undefined || !(untrusted.node(callerId) || inUntrusted)) {
        return;
    }
    for (const agent of agents) {
        const problem = untrustedStartProblem(agent.provider, !agent.chat);
        if (problem !== null) {
            throw new VerbRefusal('untrusted-folder', problem);
        }
    }
}

/*
 * One start at a time per caller. Its count is checked again under the lock of the project it writes
 * in, and since `--project` lets two starts write in two projects, that lock alone would let both pass.
 */
const callerStarts = new KeyedQueue();

/*
 * What a start in another project `--project` reached may not do: stand nowhere a person there sees it,
 * or go on to another machine. The caller is judged in its own project, before the other one's lock.
 */
async function refuseCrossingStart(
    context: ServerActionContext,
    caller: string,
    input: { viewId?: string | null; machine?: string | null; task: boolean }
): Promise<void> {
    const { host, place, origin } = context;
    if (origin === undefined) {
        return;
    }
    if (input.machine != null) {
        throw new VerbRefusal('cross-project-refused', '--machine works only from your own project; leave out --project or --machine');
    }
    if (input.viewId == null) {
        throw new VerbRefusal(
            'view-required',
            `An agent in ${place.projectId} opens on one of its canvases, where a person there sees it; name one with --view`,
            canvasLines(await host.projects.read(place.projectId))
        );
    }
    if (input.task) {
        requireChatParent(await host.projects.read(origin.projectId), caller, host.hiddenAgents?.get(caller)?.node.kind);
    }
}

/* Checked again under the lock of the project the start writes in, since that project may have closed while the start got ready. */
async function requireStillReached(context: ServerActionContext, caller: string): Promise<void> {
    if (context.origin !== undefined) {
        await reachedPlace(context.host, caller, context.place.projectId);
    }
}

type StartHandler = NonNullable<ActionHandlers<ServerActionContext>['agent.start']>;
type TeamHandler = NonNullable<ActionHandlers<ServerActionContext>['team.start']>;
type StartInput = Parameters<StartHandler>[0];

/* The widest mode a chat Voice starts may run in, until a person decides Voice may give more. */
const VOICE_CEILING: RuntimeMode = 'supervised';

/*
 * What Voice may start: an AI Chat under the person's own CLI, never a terminal, and no wider than
 * supervised, which is also the ceiling a caller that is no node gets. The catalog keeps every other
 * field an agent's, so these are the refusals left, worded for a voice and not for a command line.
 */
function refuseVoiceStart(input: StartInput): void {
    if (input.terminal) {
        throw new VerbRefusal('voice-chat-only', 'Voice starts an AI Chat, never a terminal');
    }
    if (!providerFor(input.provider).capabilities.chat) {
        throw new VerbRefusal('voice-chat-only', `${nameOf(input.provider)} has no AI Chat, and Voice starts only AI Chats`);
    }
    if (input.mode != null && input.mode !== VOICE_CEILING) {
        throw new VerbRefusal('mode-above-voice', `A chat Voice starts runs supervised at most, never ${input.mode}`);
    }
}

/* A chat of its own in the sidebar, for an agent that has no canvas to stand on; the fields a node of it would carry ride on the view. */
function looseChatView(node: ProjectNode, createdBy: string): ProjectChatView {
    return {
        kind: 'chat',
        id: node.id,
        name: node.title,
        ...(node.titleSource === undefined ? {} : { titleSource: node.titleSource }),
        node: {
            ...(node.provider === undefined ? {} : { provider: node.provider }),
            providerFixed: true,
            ...(node.cwd === undefined ? {} : { cwd: node.cwd }),
            ...(node.account === undefined ? {} : { account: node.account })
        },
        createdBy
    };
}

/*
 * The worktrees a start asks for. One on another machine is made there from this checkout when its
 * task starts; one here is made now, before the lock, so a slow repository holds up no save.
 */
async function startWorktrees(
    caller: VerbCall,
    place: IndexedPlace,
    remote: boolean,
    dryRun: boolean,
    wants: () => WorktreeWant[]
): Promise<{ source: string | undefined; paths: string[]; undo(): Promise<void> }> {
    const source = remote ? await sourceCheckout(caller.host, place, caller.caller) : undefined;
    await requireRepository(caller, place.folder);
    if (remote || dryRun) {
        return { source, paths: [], undo: async () => undefined };
    }

    const made = await makeWorktrees(caller, place, wants());

    return { source, paths: made.worktrees.map((worktree) => worktree.path), undo: made.undo };
}

const startAgent: StartHandler = (input, call) => callerStarts.run(call.actor.id, async () => await startAgentNow(input, call));

/* The start itself; a retried one never gets here, since its claim answers first. */
const startAgentNow: StartHandler = async (input, call) => {
    const { context, dryRun = false } = call;
    const { host, place } = context;
    const caller = verbCallOf(call);
    const kind = input.provider;
    const voice = call.actor.kind === 'voice';
    if (voice) {
        refuseVoiceStart(input);
    }
    await refuseCrossingStart(context, caller.caller, { viewId: input.viewId, machine: input.machine, task: input.task != null });
    const readIds = readsOf(input.reads ?? null);
    const offCanvas = input.viewId == null && place.canvasId === null;
    // A chat view keeps an agent it opens off every canvas; Voice has no chat of its own, so its chat gets a view instead.
    const loose = voice && offCanvas;
    const hidden = offCanvas && !voice;
    // The machine is judged before the agent is: a name that is none, or a combination that means nothing there, makes nothing.
    const remote = input.machine == null ? null : resolveMachine(host, place.projectId, input.machine);
    if (remote !== null) {
        refuseRemoteStart({
            cwd: input.cwd ?? null,
            task: input.task != null,
            model: input.model != null,
            effort: input.effort != null,
            base: input.base != null,
            reads: readIds.length,
            hidden
        });
    }
    const depth = depthForOpening(caller, 'agent', 1);
    // Voice is no node, so the daemon knows no mode of its own; what it starts is held to supervised, whatever the host says.
    const ceiling = voice ? VOICE_CEILING : modeForOpening(caller, input.mode ?? undefined);
    const chat = !input.terminal && providerFor(kind).capabilities.chat;
    const selection = selectionForOpening(kind, chat, input.model ?? undefined, input.effort ?? undefined, host.starts.preferredSelection(kind));
    if (input.branch != null && !input.worktree) {
        throw new VerbRefusal('branch-needs-worktree', '--branch names the branch of a worktree; add --worktree');
    }
    if (input.base != null && !input.worktree) {
        throw new VerbRefusal('base-needs-worktree', '--base says where the branch of a worktree starts; add --worktree');
    }
    if (input.worktree && input.cwd != null) {
        throw new VerbRefusal('worktree-and-cwd', '--worktree and --cwd both say where the agent starts; give one of them');
    }
    if (input.beside != null && input.group != null) {
        throw new VerbRefusal('two-places', '--beside and --group both say where the node goes; give one of them');
    }
    if (hidden && (input.beside != null || input.group != null || readIds.length > 0)) {
        throw new VerbRefusal('view-required', '--beside, --group and --reads place nodes or lines on a canvas; name one with --view');
    }
    if (loose && input.beside != null) {
        throw new VerbRefusal('no-canvas', 'This project has no canvas, so the chat opens as a view of its own and stands beside nothing');
    }
    if (hidden && host.hiddenAgents === undefined) {
        throw new VerbRefusal('view-required', OPENING_OFF_CANVAS);
    }
    // An agent on another machine runs that machine's CLI, which it checks itself when the task starts.
    if (remote === null) {
        requireInstalled(await host.starts.installedAgents(), kind);
    }

    // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
    const prompt = await startPrompt(input.prompt ?? null, input.promptFile ?? null, host, place.folder);
    if (input.task != null && prompt === null) {
        throw new VerbRefusal('task-needs-prompt', '--task gives a task and the prompt is what it asks; add --prompt or --prompt-file');
    }
    if (input.task != null && prompt !== null && prompt.length > MAX_TASK_PROMPT_LENGTH) {
        throw new VerbRefusal(
            'prompt-too-long',
            `The prompt is ${prompt.length} characters and a task takes at most ${MAX_TASK_PROMPT_LENGTH}, since the child is also told how to report back; put the rest in a file and tell the agent to read it`
        );
    }
    const checkedCwd = input.cwd == null ? undefined : await checkCwd(place.folder, input.cwd, (folder) => host.checkouts.paths(folder));
    // Voice gives no cwd, and an agent of another project stands in none of this one's folders, so the project's own folder is judged for both.
    refuseUntrustedStart(host, caller.caller, checkedCwd, [{ provider: kind, chat }], voice || context.origin !== undefined ? place.folder : undefined);
    const runtimeMode = chat ? (input.mode ?? undefined) : terminalMode(caller, input.mode ?? undefined, ceiling);
    const account = inheritedAccount(caller, kind);
    const worktrees = input.worktree
        ? await startWorktrees(caller, place, remote !== null, dryRun, () => {
              const want = input.branch == null ? { fresh: branchSlug(input.task ?? input.title ?? kind) } : { branch: input.branch };
              return [input.base == null ? want : { ...want, base: input.base }];
          })
        : null;
    const source = worktrees?.source;
    const cwd = worktrees?.paths[0] ?? checkedCwd;

    return host.projects
        .mutate<{ output: ActionOutput<'agent.start'>; operation?: { id: string; status: 'running' } }>(place.projectId, async (content) => {
            // Counted again under the lock the last start wrote its node down in: a call at the same moment read the same count.
            depthForOpening(caller, 'agent', 1);
            await requireStillReached(context, caller.caller);
            if (input.task != null && context.origin === undefined) {
                requireChatParent(content, caller.caller, host.hiddenAgents?.get(caller.caller)?.node.kind);
            }
            const canvas = hidden || loose ? null : canvasFor(content, place, input.viewId ?? undefined, OPENING_OFF_CANVAS);
            if (loose && content.views.length + 1 > MAX_PROJECT_VIEWS) {
                throw new VerbRefusal('too-many-views', `This project has ${content.views.length} views and a project holds at most ${MAX_PROJECT_VIEWS}`);
            }
            if (canvas && canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, 1);
            }
            const anchor = input.beside == null ? undefined : canvas?.nodes.find((node) => node.id === input.beside);
            if (canvas && input.beside != null && !anchor) {
                throw refuseMissingNodes(content, [input.beside], canvas.id, 'the agent this opens has nothing there to stand beside', nodeLines(canvas));
            }
            const group = input.group == null ? undefined : canvas?.nodes.find((node) => node.id === input.group && node.kind === 'group');
            if (canvas && input.group != null && !group) {
                throw new VerbRefusal('unknown-group', `${input.group} is not a group on ${canvas.id}`, groupLines(canvas));
            }
            const read = canvas ? nodesNamed(content, canvas, readIds, { cannot: 'no line can run from it into the agent this opens' }) : [];

            const kindName = chat ? ('chat' as const) : ('terminal' as const);
            const size = host.machine.nodeSize(kindName);
            const self = canvas?.nodes.find((node) => node.id === caller.caller) ?? null;
            const inGroup = group && canvas ? placeInGroup(group, groupMembers(group, canvas.nodes), size) : null;
            const rect = inGroup?.rect ?? (anchor ? placeBeside(anchor, size) : canvas ? placeFree(canvas.nodes, size, self) : { x: 0, y: 0, ...size });

            if (dryRun) {
                return {
                    content: null,
                    result: {
                        output: {
                            nodeId: NEW_NODE,
                            kind: kindName,
                            viewId: canvas?.id ?? null,
                            provider: kind,
                            edge: self && remote === null ? { edgeId: null, from: self.id, to: NEW_NODE } : null,
                            reads: read.map((node) => ({ edgeId: null, from: node.id, to: NEW_NODE })),
                            taskId: null
                        }
                    }
                };
            }

            const id = newId(
                kindName,
                content,
                host.hiddenAgents?.inProject(place.projectId).map((agent) => agent.node.id)
            );
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
                account,
                ...(runtimeMode === undefined ? {} : { runtimeMode })
            });
            // No line reaches an agent on another machine, so the opener keeps none to it.
            const edge: ProjectEdge | null = self && remote === null ? { id: mint(), from: self.id, to: id, label: 'context' } : null;
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
            const nodes = [
                ...(canvas?.nodes ?? []).map((candidate) => (group && candidate.id === group.id ? grownGroup(candidate, inGroup, id) : candidate)),
                node
            ];
            const output: ActionOutput<'agent.start'> = {
                nodeId: id,
                kind: kindName,
                viewId: canvas?.id ?? null,
                provider: kind,
                edge: edge ? { edgeId: edge.id, from: edge.from, to: edge.to } : null,
                reads: readLines,
                taskId: null
            };

            const start = async (): Promise<void> => {
                if (hidden) {
                    await host.hiddenAgents!.put({ projectId: place.projectId, openedBy: caller.caller, node: { ...node, kind: kindName } });
                }
                await host.lineage.put({ projectId: place.projectId, nodeId: id, openedBy: caller.caller, depth, agent: true, ceiling });
                if (remote !== null && input.task != null && prompt !== null) {
                    // The task first, then the entry that asks the machine to start it; the task is what the machine's answer settles.
                    const task = await host.tasks.open({
                        projectId: place.projectId,
                        parentId: caller.caller,
                        childId: id,
                        title: input.task,
                        prompt,
                        machine: remote.machineId
                    });
                    output.taskId = task.id;
                    await host.remote!.give(place.projectId, id, {
                        machineId: remote.machineId,
                        remoteProjectId: remote.remoteProjectId,
                        taskId: task.id,
                        node: kindName,
                        provider: kind,
                        parentId: caller.caller,
                        ...(input.mode == null ? {} : { mode: input.mode }),
                        ceiling,
                        depth,
                        ...(source === undefined ? {} : { source, branch: input.branch ?? branchSlug(input.task) })
                    });
                    return;
                }
                if (input.worktree && cwd !== undefined) {
                    await host.checkouts.claim(place.folder, cwd, id);
                }
                // Before the agent starts, so a child that is done at once finds its task open.
                if (input.task != null && prompt !== null) {
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
                    const first: FirstPrompt = input.task == null ? { prompt } : taskFirstPrompt(prompt, chat);
                    await host.starts.holdPrompt(place.projectId, id, first.prompt, first.brief);
                }
                await host.starts.startAgent({
                    projectId: place.projectId,
                    nodeId: id,
                    openedBy: caller.caller,
                    node: kindName,
                    provider: kind,
                    ...(selection ? { selection } : {}),
                    cwd: cwd ?? place.folder,
                    ...(runtimeMode === undefined ? {} : { runtimeMode }),
                    ...(account === undefined ? {} : { account })
                });
            };
            if (hidden) {
                await start();
            }
            return {
                landed: hidden ? undefined : start,
                content: canvas
                    ? {
                          ...content,
                          views: content.views.map((view) =>
                              view.id === canvas.id ? { ...canvas, nodes, edges: [...canvas.edges, ...(edge ? [edge] : []), ...reading] } : view
                          )
                      }
                    : loose
                      ? { ...content, views: withView(content.views, looseChatView(node, caller.caller)) }
                      : null,
                ...(remote === null ? {} : { bindMachines: new Map([[id, remote.machineId]]) }),
                // Started is not done: the outbox starts the agent, and its task or its first turn says how it went.
                result: { output, operation: { id: operationIdOf('agent.start', [id]), status: 'running' } }
            };
        })
        .catch(async (e: unknown) => {
            await worktrees?.undo();
            throw e;
        });
};

/* A start once per request id: a retry with the same id answers with what the first made. */
const claimedStart: StartHandler = (input, call) => {
    const claims = call.context.host.startClaims;
    if (input.requestId == null || call.dryRun || claims === undefined) {
        return startAgent(input, call);
    }
    const claim = { actor: call.actor, requestId: input.requestId, inputHash: startInputHash(call.context.place.projectId, input) };
    return claims.run(claim, async () => await startAgent(input, call));
};

/*
 * Everything a start enforces lives here, whoever asks: the depth and the count of agents a caller
 * may open, a mode no wider than the caller's riding on every start, a directory inside the project
 * or its worktrees, and the task only a chat may give.
 */
export const startActions: ActionHandlers<ServerActionContext> = {
    'agent.start': async (input, call) => {
        // Voice follows what it starts from before the start, so the first turn of the chat is never missed.
        const ticket = call.dryRun === true ? undefined : call.context.voice?.follow?.expectStart();
        let result: Awaited<ReturnType<StartHandler>>;
        try {
            result = await claimedStart(input, call);
        } catch (e) {
            ticket?.drop();
            throw e;
        }
        if (ticket !== undefined && 'output' in result) {
            // The chat is made and its start owed: a name that cannot be read now must not turn that into a failure Voice would retry.
            const projectId = call.context.place.projectId;
            const name = await call.context.host.projects.read(projectId).then(
                (project) => project.name ?? null,
                () => null
            );
            ticket.bind(result.output.nodeId, { chat: input.title ?? nameOf(input.provider), project: name ?? projectId });
        }
        return result;
    },
    'team.start': (input, call) => callerStarts.run(call.actor.id, () => startTeam(input, call))
};

/* A team of agents in a group of their own, under the same bounds as one agent, counted by how many it opens. */
async function startTeam(...[input, call]: Parameters<TeamHandler>): Promise<Awaited<ReturnType<TeamHandler>>> {
    const { context, dryRun = false } = call;
    const { host, place } = context;
    const caller = verbCallOf(call);
    const { roles } = input;
    await refuseCrossingStart(context, caller.caller, { viewId: input.viewId, machine: input.machine, task: input.task });
    const selections = roles.map((role, index): ModelSelection | undefined => {
        try {
            return selectionForOpening(
                role.provider,
                kindOf(role) === 'chat',
                role.model ?? undefined,
                role.effort ?? undefined,
                host.starts.preferredSelection(role.provider)
            );
        } catch (e) {
            if (e instanceof VerbRefusal) {
                throw new VerbRefusal(e.code, `role ${index} (${EFFORT_REFUSALS.has(e.code) ? 'effort' : 'model'}): ${e.message}`, e.lines);
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
    const hidden = input.viewId === null && place.canvasId === null;
    if (hidden && readIds.length > 0) {
        throw new VerbRefusal('view-required', '--reads draws lines on a canvas; name one with --view');
    }
    if (hidden && host.hiddenAgents === undefined) {
        throw new VerbRefusal('view-required', OPENING_OFF_CANVAS);
    }
    if (input.worktree && input.cwd !== null) {
        throw new VerbRefusal('worktree-and-cwd', '--worktree and --cwd both say where the agents start; give one of them');
    }
    const remote = input.machine == null ? null : resolveMachine(host, place.projectId, input.machine);
    if (remote !== null) {
        refuseRemoteStart({
            cwd: input.cwd,
            task: input.task,
            model: roles.some((role) => role.model != null),
            effort: roles.some((role) => role.effort != null),
            base: false,
            reads: readIds.length,
            hidden
        });
    }

    if (remote === null) {
        const installed = await host.starts.installedAgents();
        roles.forEach((role, index) => requireInstalled(installed, role.provider, `role ${index} (${role.provider})`));
    }

    // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
    const cwd = input.cwd === null ? undefined : await checkCwd(place.folder, input.cwd, (folder) => host.checkouts.paths(folder));
    refuseUntrustedStart(
        host,
        caller.caller,
        cwd,
        roles.map((role) => ({ provider: role.provider, chat: kindOf(role) === 'chat' })),
        context.origin === undefined ? undefined : place.folder
    );
    const worktrees = input.worktree
        ? await startWorktrees(caller, place, remote !== null, dryRun, () => roles.map((role) => ({ fresh: branchSlug(role.title) })))
        : null;
    const source = worktrees?.source;
    const roleCwds = roles.map((_role, index) => worktrees?.paths[index] ?? cwd);
    const modes: Array<RuntimeMode | undefined> = roles.map((role) =>
        kindOf(role) === 'chat' ? (input.mode ?? undefined) : terminalMode(caller, input.mode ?? undefined, ceiling)
    );
    const accounts = roles.map((role) => inheritedAccount(caller, role.provider));

    return host.projects
        .mutate<{ output: ActionOutput<'team.start'>; operation?: { id: string; status: 'running' } }>(place.projectId, async (content) => {
            depthForOpening(caller, 'team', roles.length);
            await requireStillReached(context, caller.caller);
            if (input.task && context.origin === undefined) {
                requireChatParent(content, caller.caller, host.hiddenAgents?.get(caller.caller)?.node.kind);
            }
            const canvas = hidden ? null : canvasFor(content, place, input.viewId ?? undefined, OPENING_OFF_CANVAS);
            // The group counts too, which is the one node a caller does not name in its roles.
            if (canvas && canvas.nodes.length + roles.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, roles.length + 1);
            }

            const read = canvas ? nodesNamed(content, canvas, readIds, { cannot: 'no line can run from it into the agents this opens' }) : [];
            const layout = placeTeam(roles.map((role) => host.machine.nodeSize(kindOf(role))));
            const self = canvas?.nodes.find((node) => node.id === caller.caller) ?? null;
            const origin = canvas ? placeFree(canvas.nodes, layout.frame, self) : { x: 0, y: 0, ...layout.frame };

            if (dryRun) {
                // The role rather than a placeholder every row would share: the plan is what to read before anything is made.
                const placeholders = roles.map((role) => newNode(field(role.title)));
                return {
                    content: null,
                    result: {
                        output: {
                            group: canvas ? { nodeId: NEW_NODE, title: input.label, viewId: canvas.id } : null,
                            agents: roles.map((role, index) => ({
                                nodeId: placeholders[index]!,
                                kind: kindOf(role),
                                title: role.title,
                                provider: role.provider,
                                edge: self && remote === null ? { edgeId: null, from: self.id, to: placeholders[index]! } : null,
                                taskId: null
                            })),
                            reads: placeholders.flatMap((placeholder) => read.map((node) => ({ edgeId: null, from: node.id, to: placeholder })))
                        }
                    }
                };
            }

            const taken = host.hiddenAgents?.inProject(place.projectId).map((agent) => agent.node.id) ?? [];
            const mint = (prefix: string): string => {
                const id = newId(prefix, content, taken);
                taken.push(id);
                return id;
            };

            /* A group that is not collapsed holds whatever has its center inside the frame, the same
                   rule the client reads membership by, so there is no memberIds to fill in here. */
            const groupId = mint('group');
            const group: ProjectNode = { id: groupId, kind: 'group', title: input.label, ...origin };
            const nodes: ProjectNode[] = canvas ? [group] : [];
            const edges: ProjectEdge[] = [];
            const output: ActionOutput<'team.start'> = {
                group: canvas ? { nodeId: groupId, title: input.label, viewId: canvas.id } : null,
                agents: [],
                reads: []
            };

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
                        account: accounts[index],
                        ...(modes[index] === undefined ? {} : { runtimeMode: modes[index] })
                    })
                );
                let edge: ProjectEdge | null = null;
                // No line reaches an agent on another machine, so the opener keeps none to it.
                if (self && remote === null) {
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

            const start = async (): Promise<void> => {
                const batchId = input.task ? `batch-${randomBytes(6).toString('hex')}` : undefined;
                // Every task before any agent starts, so a role that is done at once never finds its team complete without the others.
                for (const [index, made] of output.agents.entries()) {
                    if (hidden) {
                        const node = nodes.find((candidate) => candidate.id === made.nodeId)!;
                        await host.hiddenAgents!.put({ projectId: place.projectId, openedBy: caller.caller, node: { ...node, kind: made.kind } });
                    }
                    await host.lineage.put({ projectId: place.projectId, nodeId: made.nodeId, openedBy: caller.caller, depth, agent: true, ceiling });
                    if (remote !== null && batchId !== undefined) {
                        const role = roles[index]!;
                        const task = await host.tasks.open({
                            projectId: place.projectId,
                            parentId: caller.caller,
                            childId: made.nodeId,
                            title: made.title,
                            prompt: role.prompt,
                            batchId,
                            machine: remote.machineId
                        });
                        made.taskId = task.id;
                        continue;
                    }
                    const roleCwd = roleCwds[index];
                    if (input.worktree && roleCwd !== undefined) {
                        await host.checkouts.claim(place.folder, roleCwd, made.nodeId);
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
                    if (remote !== null) {
                        // Every task is written before the first is owed, so a role that is done at once never finds its team complete without the others.
                        await host.remote!.give(place.projectId, made.nodeId, {
                            machineId: remote.machineId,
                            remoteProjectId: remote.remoteProjectId,
                            taskId: made.taskId!,
                            node: made.kind,
                            provider: made.provider,
                            parentId: caller.caller,
                            ...(input.mode == null ? {} : { mode: input.mode }),
                            ceiling,
                            depth,
                            ...(source === undefined ? {} : { source, branch: branchSlug(made.title) })
                        });
                        continue;
                    }
                    const chat = made.kind === 'chat';
                    const prompt = roles[index]!.prompt;
                    const first: FirstPrompt = input.task ? taskFirstPrompt(prompt, chat) : { prompt };
                    await host.starts.holdPrompt(place.projectId, made.nodeId, first.prompt, first.brief);
                    await host.starts.startAgent({
                        projectId: place.projectId,
                        nodeId: made.nodeId,
                        openedBy: caller.caller,
                        node: made.kind,
                        provider: made.provider,
                        ...(selections[index] ? { selection: selections[index] } : {}),
                        cwd: roleCwds[index] ?? place.folder,
                        ...(modes[index] === undefined ? {} : { runtimeMode: modes[index] }),
                        ...(accounts[index] === undefined ? {} : { account: accounts[index] })
                    });
                }
            };
            if (hidden) {
                await start();
            }
            return {
                landed: hidden ? undefined : start,
                content: canvas
                    ? {
                          ...content,
                          views: content.views.map((view) =>
                              view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] } : view
                          )
                      }
                    : null,
                ...(remote === null ? {} : { bindMachines: new Map(output.agents.map((made) => [made.nodeId, remote.machineId])) }),
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
            await worktrees?.undo();
            throw e;
        });
}
