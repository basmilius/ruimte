import { MAX_PROMPT_LENGTH, pendingRequestsOf, type ActionHandlers, type ActionInput, type ActionOutput } from '@ruimte/actions';
import { isChatNode, type ChatItem, type ProjectContent } from '@ruimte/contracts';
import { matchName, resolveNames, type VoiceNameMatch } from '@ruimte/voice';
import { VerbRefusal, type CanvasHost } from '../canvas/verb.ts';
import { agentReading } from '../voice/agent-reading.ts';
import { chatExcerpt } from '../voice/chat-excerpt.ts';
import {
    nodeKindOf,
    nodeTarget,
    openableViews,
    projectAgents,
    projectChat,
    viewKindOf,
    viewTarget,
    visibleCanvas,
    type VoiceAgentPlace,
    type VoiceTarget
} from '../voice/project-reading.ts';
import { hostService, noVoiceProject, type ServerActionContext, type VoiceCaller, type VoiceOpenProject } from './context.ts';

const DEFAULT_READ = 20;

type Resolved = ActionOutput<'target.resolve'>;

/* Only Voice reaches these handlers: an agent reads a chat through its lines, with the rules of `context.read`. */
function voiceOf(context: ServerActionContext): VoiceCaller {
    if (context.voice === undefined) {
        throw new VerbRefusal('forbidden-action', 'Only Voice reads a project this way');
    }
    return context.voice;
}

/* The project the session works in now, whatever project or place the model names. */
function sessionProjectId(voice: VoiceCaller): string {
    if (voice.projectId === null) {
        throw noVoiceProject();
    }

    return voice.projectId;
}

async function sessionProject(context: ServerActionContext): Promise<{ projectId: string; content: ProjectContent }> {
    const projectId = sessionProjectId(voiceOf(context));
    return { projectId, content: await context.host.projects.read(projectId) };
}

/*
 * Refused before anything is read: a chat on another machine has nothing here but the shell it left, and
 * Voice reaches only the project its session works in now, whatever id the model names. The words are for
 * the model of a voice and name no `ruimte-context` flag.
 */
async function chatOfSession(context: ServerActionContext, chatId: string): Promise<VoiceAgentPlace & { project: string }> {
    const voice = voiceOf(context);
    const { host } = context;
    if (host.projects.machineOfNode(chatId) !== null) {
        throw new VerbRefusal('remote-target', 'That chat runs on another machine; Voice reaches only the chats of this one');
    }
    const projectId = sessionProjectId(voice);
    const place = host.projects.locate(chatId);
    const content = place?.projectId === projectId ? await host.projects.read(projectId) : null;
    const chat = content === null ? null : projectChat(content, chatId);
    if (content === null || chat === null) {
        throw new VerbRefusal('not-in-project', 'That id is no AI Chat of the project Voice works in; resolve the chat by its name first');
    }
    return { ...chat, project: content.name ?? projectId };
}

/* The projects Voice may move to: those in use on this machine, or only the current one for a session that moves nowhere. */
async function openProjectsOf(voice: VoiceCaller, context: ServerActionContext): Promise<VoiceOpenProject[]> {
    if (voice.projects !== undefined) {
        return voice.projects.open();
    }
    if (voice.projectId === null) {
        return [];
    }
    const content = await context.host.projects.read(voice.projectId);
    return [{ projectId: voice.projectId, name: content.name ?? voice.projectId, folder: context.place.folder }];
}

function projectTarget(project: VoiceOpenProject, voice: VoiceCaller): VoiceTarget {
    return {
        id: project.projectId,
        name: project.name,
        kind: 'project',
        viewId: null,
        view: null,
        endpointId: voice.projects?.machine.id ?? null,
        machine: voice.projects?.machine.label ?? null
    };
}

async function resolveProject(context: ServerActionContext, names: readonly string[] | null): Promise<Resolved> {
    const voice = voiceOf(context);
    const projects = (await openProjectsOf(voice, context)).map((project) => projectTarget(project, voice));
    if (names === null) {
        return current(
            'project',
            projects.filter((project) => project.id === voice.projectId)
        );
    }
    return named('project', names, (name) => matchName(name, projects));
}

function current(target: Resolved['target'], found: VoiceTarget[]): Resolved {
    return { target, found, ambiguous: [], missing: [] };
}

function named(target: Resolved['target'], names: readonly string[], match: (name: string) => VoiceNameMatch<VoiceTarget>): Resolved {
    return { target, ...resolveNames(names, match) };
}

/* A phone has no selection and the machine does not see its screen, so whatever a window would read off either is asked for by name. */
function needsName(what: string): VerbRefusal {
    return new VerbRefusal('needs-window', `A phone has no selection or view of the screen, so name the ${what}`);
}

type InProject = ActionInput<'target.resolve'> & { target: Exclude<ActionInput<'target.resolve'>['target'], 'project'> };

function resolveIn(content: ProjectContent, canvasId: string | null, input: InProject): Resolved {
    const { target, names, nodeKind, scope } = input;
    const canvas = visibleCanvas(content, canvasId);
    if (target === 'view') {
        if (names === null) {
            return current(target, canvas ? [viewTarget(canvas)] : []);
        }
        const views = openableViews(content).map(viewTarget);
        return named(target, names, (name) => matchName(name, views));
    }
    if (target === 'node') {
        if (scope === 'selected' || scope === 'visible' || names === null) {
            throw needsName('node');
        }
        if (canvas === null) {
            throw new VerbRefusal('no-canvas', 'This project has no canvas, so it has no nodes to name');
        }
        const nodes = canvas.nodes.filter((node) => nodeKind === null || node.kind === nodeKind).map((node) => nodeTarget(node, canvas));
        return named(target, names, (name) => matchName(name, nodes));
    }
    if (names === null) {
        throw needsName(target === 'chat' ? 'AI Chat' : 'agent');
    }
    const agents: VoiceTarget[] = projectAgents(content)
        .filter((agent) => target === 'agent' || agent.kind === 'chat')
        .map((agent) => ({ id: agent.id, name: agent.name, kind: agent.kind, viewId: agent.viewId, view: agent.view, endpointId: null, machine: null }));
    return named(target, names, (name) => {
        const exact = agents.find((agent) => agent.id === name);
        if (exact) {
            return { status: 'found', value: exact };
        }
        const qualified = matchName(name, agents, (agent) => `${agent.name} (${agent.view})`);
        return qualified.status === 'found' ? qualified : matchName(name, agents);
    });
}

/* Where a prompt or a clear goes: a chat whose CLI runs here now. `also` adds what else the model can do. */
function runningPrompts(context: ServerActionContext, chatId: string, chat: string, also = ''): NonNullable<CanvasHost['chatPrompts']> {
    const prompts = context.host.chatPrompts;
    if (prompts === undefined || !prompts.running(chatId)) {
        throw new VerbRefusal('chat-not-running', `“${chat}” does not run on the machine now. Opening it in Ruimte starts it again${also}`);
    }

    return prompts;
}

function lastSettledTurn(items: readonly ChatItem[]): string | null {
    return items.findLast((item) => item.kind === 'turn' && item.state !== 'running')?.id ?? null;
}

/* The daemon's handlers of actions that only Voice runs here, in the same registry the agents' verbs go through. */
export const voiceActions: ActionHandlers<ServerActionContext> = {
    'chat.read': async ({ chatId, limit }, { context }) => {
        const chat = await chatOfSession(context, chatId);
        const items = await hostService(context, 'chatThreads', 'no-chats', 'This machine reads no chats').items(chatId);
        if (items === null) {
            // A chat node nobody ever opened has no thread yet, which is an empty one and not an error.
            return { output: { chatId, chat: chat.name, messages: [], truncated: false } };
        }
        return { output: { chatId, chat: chat.name, ...chatExcerpt(items, limit ?? DEFAULT_READ) } };
    },
    'chat.send': async ({ chatId, prompt, delivery }, { context }) => {
        const voice = voiceOf(context);
        const chat = await chatOfSession(context, chatId);
        const prompts = runningPrompts(context, chatId, chat.name, ', or agent.start starts a new AI Chat with this prompt');
        const text = prompt.trim();
        if (text === '') {
            throw new VerbRefusal('empty-prompt', 'The prompt is empty');
        }
        if (text.length > MAX_PROMPT_LENGTH) {
            throw new VerbRefusal('prompt-too-long', `The prompt is ${text.length} characters and Voice sends at most ${MAX_PROMPT_LENGTH}`);
        }
        // Taken before the prompt goes out, so even a turn that ends before the send answers is the one told.
        const ticket = voice.follow?.expectPrompt(chatId, { chat: chat.name, project: chat.project });
        try {
            const sent = await prompts.send(chatId, text, delivery ?? undefined);
            ticket?.bind(sent.turnId);
            return { output: { chatId, chat: chat.name, queued: sent.queued, turnId: sent.turnId } };
        } catch (e) {
            ticket?.drop();
            throw e;
        }
    },
    'chat.clear': async ({ chatId }, { context, confirmed }) => {
        const voice = voiceOf(context);
        // Checked again when the person answers, since the registry runs a confirmed action through this handler anew.
        const chat = await chatOfSession(context, chatId);
        const prompts = runningPrompts(context, chatId, chat.name);
        if (!confirmed) {
            return {
                confirmation: {
                    title: `Clear AI Chat “${chat.name}”?`,
                    consequences: [
                        'The conversation history, attachments and plans will be deleted. This cannot be undone.',
                        'Any current turn and queued messages in this chat will be stopped or discarded. The chat itself stays in place.'
                    ]
                }
            };
        }
        await prompts.clear(chatId);
        // A turn Voice followed in this chat is gone with its thread, so nothing of it is told any more.
        voice.follow?.cleared(chatId);
        return { output: { chatId, chat: chat.name } };
    },
    'workspace.inspect': async (_input, { context }) => {
        const { projectId, content } = await sessionProject(context);
        const canvas = visibleCanvas(content, context.place.canvasId);
        const nodes = canvas
            ? await Promise.all(
                  canvas.nodes.map(async (node) => {
                      // A design node's own chat runs under the node id, so it reads as any chat.
                      const agent = isChatNode(node)
                          ? await agentReading(context.host, { id: node.id, kind: 'chat' })
                          : node.kind === 'terminal'
                            ? await agentReading(context.host, { id: node.id, kind: 'terminal' })
                            : null;
                      return { id: node.id, title: node.title, kind: nodeKindOf(node), visible: false, ...(agent === null ? {} : { status: agent.status }) };
                  })
              )
            : [];
        return {
            output: {
                project: content.name ?? projectId,
                revision: await context.host.projects.revision(projectId),
                activeView: canvas ? { id: canvas.id, name: canvas.name, kind: 'canvas' } : null,
                views: openableViews(content).map((view) => ({ id: view.id, name: view.name ?? view.id, kind: viewKindOf(view) })),
                cells: [],
                canvas: canvas ? { viewId: canvas.id, nodes, selected: [] } : null,
                unknown: ['cells', 'selection', 'visible']
            }
        };
    },
    'target.resolve': async (input, { context }) => {
        const { target } = input;
        if (target === 'project') {
            return { output: await resolveProject(context, input.names) };
        }
        const { content } = await sessionProject(context);
        return { output: resolveIn(content, context.place.canvasId, { ...input, target }) };
    },
    'chat.inspect': async ({ chatId }, { context }) => {
        const chat = await chatOfSession(context, chatId);
        const info = await context.host.chatThreads?.info?.(chatId);
        if (!info) {
            throw new VerbRefusal('chat-not-started', `“${chat.name}” has not started yet, so there is nothing to inspect`);
        }
        const items = (await context.host.chatThreads?.items(chatId)) ?? [];
        const working = info.activeTurnId !== null;
        return {
            output: {
                chatId,
                chat: chat.name,
                provider: info.provider,
                model: info.selection.model,
                options: info.selection.options,
                runtimeMode: info.runtimeMode,
                status: info.status,
                working,
                // The machine holds every thread whole, open in a window or not.
                open: true,
                queue: (info.queue ?? []).map((message) => ({ messageId: message.id, text: message.text })),
                ...pendingRequestsOf(items),
                // Voice stops nothing on the machine, so none of them is stoppable from here.
                subagents: items.flatMap((item) =>
                    item.kind === 'subagent'
                        ? [{ toolUseId: item.toolUseId, title: item.description || (item.subagentType ?? 'Sub-agent'), status: item.status, stoppable: false }]
                        : []
                ),
                // A background task by its description, never its command, for the reason an approval leaves out its input.
                tasks: (info.background ?? []).map((task) => ({ taskId: task.id, kind: task.kind, description: task.description, command: null })),
                lastTurnId: lastSettledTurn(items),
                forkOf: info.forkOf ? { chatId: info.forkOf.chatId, turnId: info.forkOf.turnId } : null
            }
        };
    },
    'agents.inspect': async (_input, { context }) => {
        const { projectId, content } = await sessionProject(context);
        const agents = await Promise.all(
            projectAgents(content)
                // A chat or a terminal on another machine has nothing here but the shell it left.
                .filter((agent) => context.host.projects.machineOfNode(agent.id) === null)
                .map(async (agent) => {
                    const read = await agentReading(context.host, agent);
                    return read === null ? [] : [{ ...agent, ...read, selected: false, toolHistory: agent.kind === 'chat' }];
                })
        );
        return { output: { project: content.name ?? projectId, connected: true, observedAt: Date.now(), agents: agents.flat() } };
    },
    'project.list': async (_input, { context }) => {
        const voice = voiceOf(context);
        const machine = voice.projects?.machine ?? null;
        const projects = (await openProjectsOf(voice, context)).map((project) => ({
            endpointId: machine?.id ?? '',
            projectId: project.projectId,
            name: project.name,
            machine: machine?.label ?? '',
            folder: project.folder,
            recent: false,
            active: project.projectId === voice.projectId,
            available: true
        }));
        return { output: { projects } };
    },
    'project.switch': async ({ endpointId, projectId }, { context }) => {
        const voice = voiceOf(context);
        const focus = voice.projects;
        if (focus === undefined) {
            throw new VerbRefusal('voice-no-switch', 'This Voice session works in one project only');
        }
        if (endpointId !== focus.machine.id) {
            throw new VerbRefusal('remote-target', 'Voice works only in the projects of this machine; read project.list for the ids');
        }
        const project = await focus.switchTo(projectId);
        return { output: { project: project.name, endpointId: focus.machine.id, projectId: project.projectId } };
    }
};
