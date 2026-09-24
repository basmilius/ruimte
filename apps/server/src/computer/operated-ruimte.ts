import type { ProjectView, RequestMap, RequestType, RuntimeMode } from '@ruimte/contracts';
import { narrowerMode } from '../canvas/mode.ts';
import { RequestError, type ClientConnection } from '../dispatcher.ts';
import { DEFAULT_RUNTIME_MODE } from '../providers/launch.ts';
import { commandsSet, type NodeCommand } from '../sessions/command-approvals.ts';

export const AGENT_OPERATING = 'agent-operating';

const OPERATING_WORDS = 'An agent is operating Ruimte, so this window cannot decide this for you. Take over or pause the session to decide yourself';

/*
 * The Ruimte window on this Mac: the one client that presented the local secret, which only a process
 * of this user can read. A phone, the station or another computer is paired and carries a session, and
 * the source address says nothing, since behind a tunnel everyone is loopback.
 */
export const isLocalWindow = (client: ClientConnection): boolean => client.access?.sessionId === null;

export type WireRequest = { [T in RequestType]: { type: T; payload: RequestMap[T]['payload'] } }[RequestType];

export interface OperatedContext {
    /* The chat or terminal whose agent holds the session; its own node is still its to type into. */
    holder: string | null;
    modeOf(nodeId: string): RuntimeMode;
    saveBase(projectId: string): { views: readonly ProjectView[]; shared: readonly string[] } | null;
}

/*
 * What a person alone decides: an answer to an agent's prompt or card, taking an app or a device back from agents,
 * a command let into a terminal, who may reach this machine, and the git steps the catalog leaves to a
 * person. Ordinary work (editing, committing, moving the canvas) is not on the list, so Ruimte stays operable.
 */
const ALWAYS: ReadonlySet<RequestType> = new Set<RequestType>([
    'computer.answer',
    'computer.revoke',
    'device.control',
    'chat.approve',
    'chat.answer',
    'chat.dismiss',
    'agent.answerApproval',
    'plan.apply',
    'session.runHeld',
    'processes.signal',
    'auth.pairingToken',
    'auth.registerKey',
    'auth.revoke',
    'endpoint.setIdentity',
    'endpoint.signRegistration',
    'project.delete',
    'git.resolve',
    'git.worktree-remove'
]);

const setsSameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

/* A mode above the holder's, which a verb would refuse as well: an agent never opens anything wider than itself. */
const widens = (mode: RuntimeMode, context: OperatedContext): boolean =>
    narrowerMode(mode, context.holder === null ? 'supervised' : context.modeOf(context.holder)) !== mode;

/* The commands a save sets or changes; a project that is not open sets none here, and its save fails by itself. */
export const commandsSavedBy = (request: RequestMap['project.save']['payload'], context: OperatedContext): NodeCommand[] => {
    const base = context.saveBase(request.projectId);
    return base === null ? [] : commandsSet(base.views, request.content.views);
};

/* Whether a request carries a person's authority, which a window an agent operates does not have. */
export const carriesPersonAuthority = (request: WireRequest, context: OperatedContext): boolean => {
    if (ALWAYS.has(request.type)) {
        return true;
    }
    switch (request.type) {
        case 'session.write':
        case 'session.kill':
            return request.payload.sessionId !== context.holder;
        case 'chat.send':
        case 'chat.sendNow':
        case 'chat.kill':
            return request.payload.chatId !== context.holder;
        case 'chat.create':
            return widens(request.payload.runtimeMode ?? DEFAULT_RUNTIME_MODE, context);
        case 'chat.configure':
            return (request.payload.runtimeMode !== undefined && widens(request.payload.runtimeMode, context)) || request.payload.resumeAtReset === true;
        case 'session.create':
            return request.payload.agent !== undefined && widens(request.payload.agent.runtimeMode ?? DEFAULT_RUNTIME_MODE, context);
        case 'git.operation':
            return request.payload.action === 'continue';
        case 'git.action':
            return request.payload.kind === 'force-push' || request.payload.kind === 'rebase' || request.payload.strategy !== undefined;
        case 'project.save': {
            const base = context.saveBase(request.payload.projectId);
            const shared = request.payload.shared;
            return commandsSavedBy(request.payload, context).length > 0 || (base !== null && shared !== undefined && !setsSameIds(shared, base.shared));
        }
        default:
            return false;
    }
};

export interface OperatedRuimteOptions {
    /* Whether an agent operates Ruimte now, asked of the helper again before it says yes. */
    operating(): Promise<boolean>;
    context(): OperatedContext;
}

/*
 * While an agent's computer use session operates Ruimte, nothing the Ruimte window on this Mac sends
 * counts as the person. This is the boundary; the window only explains it.
 */
export class OperatedRuimte {
    private readonly options: OperatedRuimteOptions;
    // Commands a refused save carried, which a later save from the same screen would otherwise approve unseen.
    private readonly refusedCommands = new Set<string>();

    constructor(options: OperatedRuimteOptions) {
        this.options = options;
    }

    async check(request: WireRequest, client: ClientConnection): Promise<void> {
        if (!isLocalWindow(client)) {
            return;
        }
        const context = this.options.context();
        if (!carriesPersonAuthority(request, context) || !(await this.options.operating())) {
            return;
        }
        if (request.type === 'project.save') {
            for (const { nodeId, command } of commandsSavedBy(request.payload, context)) {
                this.refusedCommands.add(`${nodeId}\0${command}`);
            }
        }
        throw new RequestError(AGENT_OPERATING, OPERATING_WORDS);
    }

    /* A command a save set while an agent operated Ruimte: it stays held until a person runs it. */
    refusedCommand(nodeId: string, command: string): boolean {
        return this.refusedCommands.has(`${nodeId}\0${command}`);
    }
}
