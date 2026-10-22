import i18next from 'i18next';
import { ACTION_DEFINITIONS, VOICE_CONTROL_TOOL, VOICE_TOOL_ACTIONS, type ActionName, type ActionOutput, type ActionResult } from '@ruimte/actions';
import { voiceReplyOf, type VoiceChatFollowUp, type VoiceReplyWords, type VoiceWatchedSession } from '@ruimte/voice';
import { clientActions, VOICE_ACTION_CALL } from '@/actions/client-actions';
import { accentLabel } from '@/canvas/accents';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { endpointOfNodeId } from '@/state/node-endpoint';
import type { VoiceActionKind } from '@/voice/state';
import { objectArguments } from '@/voice/tool-arguments';
import { voiceWorkspaceRevision } from '@/voice/workspace-context';

/* What the activity log shows a person; the message beside it is for the model and stays English. */
function activity(key: string): string {
    return i18next.t(`voice:activity.${key}`);
}

const REPLY_WORDS: VoiceReplyWords = {
    activity,
    machine: (endpointId) => useEndpoints.getState().endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? endpointId,
    color: (accent) => (accent === null ? i18next.t('canvas:menu.noAccent') : accentLabel(accent))
};

interface ToolAction {
    kind: VoiceActionKind;
    label: string;
    detail: string;
    undo?: () => void;
}

export interface VoiceToolExecution {
    output: Record<string, unknown>;
    action?: ToolAction;
    followUp?: VoiceChatFollowUp;
    watch?: VoiceWatchedSession;
    clearedChatKey?: string;
}

/* The switch in Settings speaks of deletions, so only what removes something skips its question when it is off. */
const DELETIONS: ReadonlySet<ActionName> = new Set(['view.delete', 'node.delete', 'layout.delete', 'chat.clear', 'terminal.clear']);

function failed(message: string, data: Record<string, unknown> = {}): VoiceToolExecution {
    return {
        output: { ok: false, message, ...data }
    };
}

function failureOf(result: ActionResult): VoiceToolExecution {
    return result.status === 'needs_confirmation'
        ? failed('Ask the user to confirm or cancel this action before continuing.', {
              needs_confirmation: true,
              confirmation_token: result.confirmationToken,
              confirmation: result.confirmation
          })
        : failed(result.status === 'failed' ? result.error.message : 'The action could not be completed.', {
              code: result.status === 'failed' ? result.error.code : result.status
          });
}

function completed(name: ActionName, output: Record<string, unknown>, undoToken: string | undefined, endpointId: string): VoiceToolExecution {
    const reply = voiceReplyOf(name, output, REPLY_WORDS);
    const execution: VoiceToolExecution = { output: { ok: true, message: reply.message, ...output } };
    if (reply.entry) {
        execution.action = { ...reply.entry };
        if (undoToken) {
            execution.action.undo = () => {
                void clientActions.undo(undoToken, VOICE_ACTION_CALL);
            };
        }
    }
    if (name === 'chat.clear') {
        execution.clearedChatKey = endpointKey(endpointId, (output as ActionOutput<'chat.clear'>).chatId);
    }
    return execution;
}

/* A strict tool carries every field of its domain; the action gets only its own, and the registry validates those. */
function inputOf(name: ActionName, args: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.keys(ACTION_DEFINITIONS[name].input.shape).map((field) => [field, args[field] ?? null]));
}

async function executed(name: ActionName, input: Record<string, unknown>): Promise<ActionResult> {
    const revision = voiceWorkspaceRevision();
    const result = await clientActions.execute(name, input, VOICE_ACTION_CALL);
    if (result.status !== 'needs_confirmation') {
        return result;
    }
    if (revision !== voiceWorkspaceRevision()) {
        return {
            status: 'failed',
            action: name,
            error: { code: 'workspace-changed', message: 'The project changed before confirmation. Request the action again.' }
        };
    }
    if (!DELETIONS.has(name) || useSettings.getState().voiceConfirmDestructiveActions) {
        return result;
    }
    return clientActions.confirm(result.confirmationToken, true, VOICE_ACTION_CALL);
}

/* Every prompt Voice sends is followed, since the speech model only asked for a report when a person happened to say so. */
function sent(output: ActionOutput<'chat.send'>, prompt: string, endpointId: string, project: string): VoiceToolExecution {
    const cannotFollow = output.turnId === undefined;
    const execution: VoiceToolExecution = {
        output: {
            ok: true,
            message: `${output.queued ? 'Queued' : 'Submitted'} the prompt in “${output.chat}”.${cannotFollow ? ' Ruimte cannot report when it finishes until Ruimte on this machine is updated.' : ' Ruimte reports when it finishes or waits for the user.'}`,
            ...output
        },
        action: {
            kind: 'chat',
            label: activity(output.queued ? 'queuedPrompt' : 'prompted'),
            detail: `${output.chat}: ${prompt.slice(0, 120)}`
        }
    };
    if (output.turnId === undefined) {
        return execution;
    }
    return {
        ...execution,
        followUp: { key: endpointKey(endpointId, output.chatId), chatId: output.chatId, project, chat: output.chat, turnId: output.turnId }
    };
}

function terminalWatch(nodeId: string, name: string, project: string): VoiceWatchedSession {
    return { key: endpointKey(endpointOfNodeId(nodeId), nodeId), kind: 'terminal', name, project };
}

/* A terminal agent says nothing over the wire about its answer, but its status tells when it finished or waits. */
function watchedTerminal(name: ActionName, input: Record<string, unknown>, output: Record<string, unknown>, project: string): VoiceWatchedSession | undefined {
    if (name === 'node.create') {
        const created = output as ActionOutput<'node.create'>;
        return created.kind === 'terminal' && input.provider != null ? terminalWatch(created.nodeId, created.node, project) : undefined;
    }
    if (name === 'terminal.resumeAgent') {
        const resumed = output as ActionOutput<'terminal.resumeAgent'>;
        return terminalWatch(resumed.terminalId, resumed.terminal, project);
    }
    return undefined;
}

async function runAction(name: ActionName, args: Record<string, unknown>): Promise<VoiceToolExecution> {
    const endpointId = currentEndpointId();
    const project = useProject.getState().current?.name ?? 'Untitled project';
    const input = inputOf(name, args);
    const result = await executed(name, input);
    if (result.status !== 'completed') {
        return failureOf(result);
    }
    if (result.action === 'chat.send') {
        return sent(result.output as ActionOutput<'chat.send'>, String(input.prompt), endpointId, project);
    }
    const output = result.output as Record<string, unknown>;
    const execution = completed(result.action, output, result.undoToken, endpointId);
    const watch = watchedTerminal(result.action, input, output, project);
    return watch ? { ...execution, watch } : execution;
}

async function controlAction(args: Record<string, unknown>): Promise<VoiceToolExecution> {
    const token = typeof args.confirmation_token === 'string' ? args.confirmation_token : null;
    if (!token || (args.action !== 'confirm' && args.action !== 'cancel')) {
        return failed('Choose confirm or cancel and provide the confirmation token.', { code: 'invalid-confirmation' });
    }
    const endpointId = currentEndpointId();
    const result = await clientActions.confirm(token, args.action === 'confirm', VOICE_ACTION_CALL);
    return result.status === 'completed' ? completed(result.action, result.output as Record<string, unknown>, result.undoToken, endpointId) : failureOf(result);
}

async function runVoiceTool(tool: string, rawArguments: string): Promise<VoiceToolExecution> {
    if (useProject.getState().switching) {
        return failed('A project switch is in progress. Wait and inspect the workspace before retrying.', { code: 'project-switching' });
    }
    const args = objectArguments(rawArguments);
    if (!args) {
        return failed('The tool arguments were not valid JSON.', { code: 'invalid-arguments' });
    }
    if (tool === VOICE_CONTROL_TOOL) {
        return controlAction(args);
    }
    const actions = VOICE_TOOL_ACTIONS.get(tool);
    if (!actions) {
        return failed(`Ruimte does not support the tool “${tool}”.`, { code: 'unknown-tool' });
    }
    const action = actions.find((name) => name === args.action);
    if (!action) {
        return failed(`Choose one of ${actions.join(', ')} as the action of ${tool}.`, { code: 'unknown-action' });
    }
    return runAction(action, args);
}

/* A cancel stops a run the queue is still waiting on, so it runs beside the queue rather than behind it. */
export function bypassesQueue(tool: string, rawArguments: string): boolean {
    return VOICE_TOOL_ACTIONS.get(tool)?.includes('operation.cancel') === true && objectArguments(rawArguments)?.action === 'operation.cancel';
}

const confirmationRevisions = new Map<string, number>();

export async function executeVoiceTool(tool: string, rawArguments: string): Promise<VoiceToolExecution> {
    const revision = voiceWorkspaceRevision();
    if (tool === VOICE_CONTROL_TOOL) {
        const token = objectArguments(rawArguments)?.confirmation_token;
        if (typeof token !== 'string' || confirmationRevisions.get(token) !== revision) {
            return failed('This confirmation no longer belongs to the current project. Request the action again.', { code: 'stale-confirmation' });
        }
        confirmationRevisions.delete(token);
    }
    const result = await runVoiceTool(tool, rawArguments);
    const token = result.output.confirmation_token;
    if (typeof token === 'string') {
        confirmationRevisions.set(token, revision);
        if (confirmationRevisions.size > 100) {
            confirmationRevisions.delete(confirmationRevisions.keys().next().value!);
        }
    }
    const action = result.action;
    const undo = action?.undo;
    if (action && undo) {
        action.undo = () => {
            if (voiceWorkspaceRevision() !== revision) {
                throw new Error('This action belongs to a previous workspace.');
            }
            undo();
        };
    }
    return result;
}
