import type { ActionHandlers, ActionInput, ActionOutput } from '@ruimte/actions';
import type { AgentStatus, ChatInfo, ChatItem, ProjectContent } from '@ruimte/contracts';
import { matchName, resolveNames, type VoiceNameMatch } from '@ruimte/voice';
import { VerbRefusal } from '../canvas/verb.ts';
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
import type { ServerActionContext, VoiceCaller } from './context.ts';

const DEFAULT_READ = 20;

type AgentRead = AgentStatus | 'unknown';
type Resolved = ActionOutput<'target.resolve'>;

/* Only Voice reaches these handlers: an agent reads a chat through its lines, with the rules of `context.read`. */
function voiceOf(context: ServerActionContext): VoiceCaller {
    if (context.voice === undefined) {
        throw new VerbRefusal('forbidden-action', 'Only Voice reads a project this way');
    }
    return context.voice;
}

/* The project the session started in, whatever project or place the model names. */
async function sessionProject(context: ServerActionContext): Promise<{ voice: VoiceCaller; content: ProjectContent }> {
    const voice = voiceOf(context);
    return { voice, content: await context.host.projects.read(voice.projectId) };
}

/*
 * Refused before anything is read: a chat on another machine has nothing here but the shell it left, and
 * Voice reaches only the project its session started in, whatever id the model names. The words are for
 * the model of a voice and name no `ruimte-context` flag.
 */
async function chatOfSession(context: ServerActionContext, chatId: string): Promise<VoiceAgentPlace> {
    const voice = voiceOf(context);
    const { host } = context;
    if (host.projects.machineOfNode(chatId) !== null) {
        throw new VerbRefusal('remote-target', 'That chat runs on another machine; Voice reaches only the chats of this one');
    }
    const place = host.projects.locate(chatId);
    const chat = place?.projectId === voice.projectId ? projectChat(await host.projects.read(voice.projectId), chatId) : null;
    if (chat === null) {
        throw new VerbRefusal('not-in-project', 'That id is no AI Chat of this project; resolve the chat by its name first');
    }
    return chat;
}

async function chatInfoOf(context: ServerActionContext, chatId: string): Promise<ChatInfo | null> {
    return (await context.host.chatThreads?.info?.(chatId)) ?? null;
}

/*
 * What an agent does as the machine knows it. A chat nobody opened since a restart is idle on its record;
 * a terminal is an agent only while its hooks speak, and one the machine runs no session for is unknown.
 * Null for a plain shell, which is no agent at all.
 */
async function agentRead(
    context: ServerActionContext,
    agent: VoiceAgentPlace
): Promise<{ status: AgentRead; working: boolean | null; updatedAt: number | null } | null> {
    if (agent.kind === 'chat') {
        const info = await chatInfoOf(context, agent.id);
        return info === null
            ? { status: 'unknown', working: null, updatedAt: null }
            : { status: info.status, working: info.activeTurnId !== null, updatedAt: null };
    }
    const session = context.host.terminals?.agentOf(agent.id);
    if (session === null) {
        return null;
    }
    if (session === undefined) {
        return { status: 'unknown', working: null, updatedAt: null };
    }
    const status: AgentRead = session.live ? session.status : session.status === 'exited' ? 'exited' : 'unknown';
    return { status, working: status === 'unknown' ? null : status === 'running', updatedAt: session.updatedAt };
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

function resolveIn(content: ProjectContent, voice: VoiceCaller, canvasId: string | null, input: ActionInput<'target.resolve'>): Resolved {
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
    if (target === 'chat' || target === 'agent') {
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
    // Voice reaches the one project its session started in, so that is every project it can name.
    const project: VoiceTarget = {
        id: voice.projectId,
        name: content.name ?? voice.projectId,
        kind: 'project',
        viewId: null,
        view: null,
        endpointId: null,
        machine: null
    };
    return names === null ? current(target, [project]) : named(target, names, (name) => matchName(name, [project]));
}

function pendingRequests(items: readonly ChatItem[]) {
    return {
        questions: items.flatMap((item) =>
            item.kind === 'question' && item.state === 'pending'
                ? [
                      {
                          requestId: item.requestId,
                          itemId: item.id,
                          optional: item.async === true,
                          questions: item.questions.map((question) => ({
                              questionId: question.id,
                              header: question.header,
                              question: question.question,
                              choices: question.choices.map((choice) => choice.label),
                              multiSelect: question.multiSelect
                          }))
                      }
                  ]
                : []
        ),
        // An approval by its tool and the description it came with, never by its input: that is a command or a path, which may hold a secret.
        approvals: items.flatMap((item) =>
            item.kind === 'approval' && item.decision === 'pending' ? [{ requestId: item.requestId, tool: item.toolName, description: item.description }] : []
        )
    };
}

function lastSettledTurn(items: readonly ChatItem[]): string | null {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind === 'turn' && item.state !== 'running') {
            return item.id;
        }
    }
    return null;
}

/* The daemon's handlers of actions that only Voice runs here, in the same registry the agents' verbs go through. */
export const voiceActions: ActionHandlers<ServerActionContext> = {
    'chat.read': async ({ chatId, limit }, { context }) => {
        const chat = await chatOfSession(context, chatId);
        const threads = context.host.chatThreads;
        if (threads === undefined) {
            throw new VerbRefusal('no-chats', 'This machine reads no chats');
        }
        const items = await threads.items(chatId);
        if (items === null) {
            // A chat node nobody ever opened has no thread yet, which is an empty one and not an error.
            return { output: { chatId, chat: chat.name, messages: [], truncated: false } };
        }
        return { output: { chatId, chat: chat.name, ...chatExcerpt(items, limit ?? DEFAULT_READ) } };
    },
    'workspace.inspect': async (_input, { context }) => {
        const { voice, content } = await sessionProject(context);
        const canvas = visibleCanvas(content, context.place.canvasId);
        const nodes = canvas
            ? await Promise.all(
                  canvas.nodes.map(async (node) => {
                      const agent =
                          node.kind === 'chat' || node.kind === 'terminal'
                              ? await agentRead(context, { id: node.id, name: node.title, kind: node.kind, viewId: canvas.id, view: canvas.name })
                              : null;
                      return { id: node.id, title: node.title, kind: nodeKindOf(node), visible: false, ...(agent === null ? {} : { status: agent.status }) };
                  })
              )
            : [];
        return {
            output: {
                project: content.name ?? voice.projectId,
                revision: await context.host.projects.revision(voice.projectId),
                activeView: canvas ? { id: canvas.id, name: canvas.name, kind: 'canvas' } : null,
                views: openableViews(content).map((view) => ({ id: view.id, name: view.name ?? view.id, kind: viewKindOf(view) })),
                cells: [],
                canvas: canvas ? { viewId: canvas.id, nodes, selected: [] } : null,
                unknown: ['cells', 'selection', 'visible']
            }
        };
    },
    'target.resolve': async (input, { context }) => {
        const { voice, content } = await sessionProject(context);
        return { output: resolveIn(content, voice, context.place.canvasId, input) };
    },
    'chat.inspect': async ({ chatId }, { context }) => {
        const chat = await chatOfSession(context, chatId);
        const info = await chatInfoOf(context, chatId);
        if (info === null) {
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
                ...pendingRequests(items),
                // Voice stops nothing on the machine, so none of them is stoppable from here.
                subagents: items.flatMap((item) =>
                    item.kind === 'subagent'
                        ? [{ toolUseId: item.toolUseId, title: item.description || (item.subagentType ?? 'Sub-agent'), status: item.status, stoppable: false }]
                        : []
                ),
                tasks: (info.background ?? []).map((task) => ({ taskId: task.id, kind: task.kind, description: task.description, command: task.command })),
                lastTurnId: lastSettledTurn(items),
                forkOf: info.forkOf ? { chatId: info.forkOf.chatId, turnId: info.forkOf.turnId } : null
            }
        };
    },
    'agents.inspect': async (_input, { context }) => {
        const { voice, content } = await sessionProject(context);
        const agents = await Promise.all(
            projectAgents(content)
                // A chat or a terminal on another machine has nothing here but the shell it left.
                .filter((agent) => context.host.projects.machineOfNode(agent.id) === null)
                .map(async (agent) => {
                    const read = await agentRead(context, agent);
                    return read === null ? [] : [{ ...agent, ...read, selected: false, toolHistory: agent.kind === 'chat' }];
                })
        );
        return { output: { project: content.name ?? voice.projectId, connected: true, observedAt: Date.now(), agents: agents.flat() } };
    }
};
