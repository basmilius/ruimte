import type { PromptAction, ApprovalButtonSpec, HostPrompt, PromptSubject } from '@adecore/agents-react/prompts';
import type { AgentRequest, ComputerApproval, ComputerApprovalChoice, ProjectProposal, SecretRequest, TunnelProposal } from '@ruimte/contracts';
import i18next from 'i18next';
import type { ProposalAnswers, TunnelProposalAnswers } from '@/proposals/answer';
import type { SecretAnswers } from '@/secrets/answer';

/*
 * What Ruimte asks beside a chat's own prompts. The machine asks, and not the CLI, for an agent to
 * operate an app, for a launch's secret and about an agent's suggestion to make its chat a project
 * or to change a hostname of the machine's tunnel. A terminal whose TUI waits is answered only in that TUI.
 */
type RuimtePromptData =
    | { kind: 'computer-approval'; request: ComputerApproval }
    | { kind: 'secret-request'; endpointId: string; request: SecretRequest }
    | { kind: 'project-proposal'; endpointId: string; proposal: ProjectProposal }
    | { kind: 'tunnel-proposal'; endpointId: string; proposal: TunnelProposal }
    | { kind: 'terminal-waiting'; since: number; request?: AgentRequest };

/* The field of a secret card's answer; the value travels in it only from the card to the machine. */
export const SECRET_ANSWER_FIELD = 'value';

/* Decline is the one choice a secret card offers besides Save, and the one a suggestion's card sends to the machine. */
export const SECRET_DECLINE = 'decline';

/* The choice of a tunnel suggestion's Confirm, which makes the change on the machine. */
export const TUNNEL_CONFIRM = 'confirm';

export interface RuimtePrompt extends HostPrompt {
    data: RuimtePromptData;
}

const COMPUTER_CHOICES: readonly string[] = ['once', 'always', 'deny'] satisfies ComputerApprovalChoice[];

function isComputerChoice(choiceId: string): choiceId is ComputerApprovalChoice {
    return COMPUTER_CHOICES.includes(choiceId);
}

export function computerPrompt(nodeId: string, request: ComputerApproval): RuimtePrompt {
    return {
        id: `computer:${nodeId}:${request.requestId}`,
        createdAt: request.createdAt,
        blocking: true,
        asks: 'approval',
        data: { kind: 'computer-approval', request }
    };
}

export function secretPrompt(endpointId: string, nodeId: string, request: SecretRequest): RuimtePrompt {
    return {
        id: `secret:${nodeId}:${request.requestId}`,
        createdAt: request.createdAt,
        blocking: true,
        asks: 'question',
        data: { kind: 'secret-request', endpointId, request }
    };
}

export function proposalPrompt(endpointId: string, chatId: string, proposal: ProjectProposal): RuimtePrompt {
    return {
        id: `project-proposal:${chatId}:${proposal.proposalId}`,
        createdAt: proposal.createdAt,
        blocking: true,
        asks: 'question',
        data: { kind: 'project-proposal', endpointId, proposal }
    };
}

export function tunnelProposalPrompt(endpointId: string, chatId: string, proposal: TunnelProposal): RuimtePrompt {
    return {
        id: `tunnel-proposal:${chatId}:${proposal.proposalId}`,
        createdAt: proposal.createdAt,
        blocking: true,
        asks: 'question',
        data: { kind: 'tunnel-proposal', endpointId, proposal }
    };
}

/* What a tunnel suggestion does, in the words its card is headed with. */
export function tunnelProposalHeading(proposal: TunnelProposal): string {
    const words = { hostname: proposal.hostname, port: String(proposal.port ?? '') };

    if (proposal.kind === 'mcp' && proposal.action === 'on') {
        return i18next.t('prompts:tunnelProposal.onMcp', words);
    }

    return i18next.t(`prompts:tunnelProposal.${proposal.action}`, words);
}

export function waitingPrompt(nodeId: string, since: number, request?: AgentRequest): RuimtePrompt {
    return {
        id: `waiting:${nodeId}${request ? `:${request.id}` : ''}`,
        createdAt: since,
        blocking: true,
        asks: request?.kind ?? 'approval',
        data: { kind: 'terminal-waiting', since, ...(request ? { request } : {}) }
    };
}

const RUIMTE_KINDS: ReadonlySet<unknown> = new Set<RuimtePromptData['kind']>([
    'computer-approval',
    'secret-request',
    'project-proposal',
    'tunnel-proposal',
    'terminal-waiting'
]);

export function isRuimtePrompt(prompt: HostPrompt): prompt is RuimtePrompt {
    return RUIMTE_KINDS.has((prompt.data as Partial<RuimtePromptData> | null)?.kind);
}

/* Terminal status snapshots rebuild requests, so equal content must still keep the stack steady. */
export function ruimtePayloadOf(subject: PromptSubject): unknown {
    if (subject.kind === 'chat') {
        return subject.item;
    }
    if (!isRuimtePrompt(subject.prompt)) {
        return subject.prompt.data;
    }
    const { data } = subject.prompt;
    if (data.kind === 'computer-approval' || data.kind === 'secret-request') {
        return data.request;
    }
    if (data.kind === 'project-proposal' || data.kind === 'tunnel-proposal') {
        return data.proposal;
    }
    return data.request ? JSON.stringify(data.request) : data.since;
}

/* The buttons of an approval to operate an app: Deny, Always allow, and Allow this time as the primary. */
export function computerButtons(): ApprovalButtonSpec[] {
    const choose = (choiceId: ComputerApprovalChoice) => ({ kind: 'choose', choiceId }) as const;
    return [
        { id: 'deny', label: i18next.t('prompts:computer.deny'), primary: false, action: choose('deny') },
        { id: 'always', label: i18next.t('prompts:computer.always'), primary: false, lasting: true, action: choose('always') },
        { id: 'once', label: i18next.t('prompts:computer.once'), primary: true, action: choose('once') }
    ];
}

/*
 * Sends a card's answer to the machine, which says whether it still waited. A waiting terminal is
 * answered only in its TUI, so it sends nothing.
 */
export async function answerRuimtePrompt(
    prompt: HostPrompt,
    action: PromptAction,
    answerComputer: (requestId: string, choice: ComputerApprovalChoice) => Promise<boolean>,
    secrets: SecretAnswers,
    proposals?: ProposalAnswers,
    tunnels?: TunnelProposalAnswers
): Promise<void> {
    if (!isRuimtePrompt(prompt) || prompt.data.kind === 'terminal-waiting') {
        throw new Error(i18next.t('prompts:error.terminalOnly'));
    }
    const { data } = prompt;
    const declined = action.kind === 'choose' && action.choiceId === SECRET_DECLINE;
    let accepted = false;
    if (data.kind === 'tunnel-proposal') {
        const { endpointId, proposal } = data;
        if (tunnels !== undefined && declined) {
            accepted = await tunnels.decline(endpointId, proposal.proposalId);
        } else if (tunnels !== undefined && action.kind === 'choose' && action.choiceId === TUNNEL_CONFIRM) {
            // A refusal of the machine or Cloudflare throws its own sentence, which the card shows.
            accepted = await tunnels.confirm(endpointId, proposal.proposalId);
        }
    } else if (data.kind === 'project-proposal') {
        // Review opens the dialog from the card itself; only a no reaches the machine from here.
        accepted = declined && proposals !== undefined && (await proposals.decline(data.endpointId, data.proposal.proposalId));
    } else if (data.kind === 'secret-request') {
        const value = action.kind === 'answer' ? action.answers[SECRET_ANSWER_FIELD] : undefined;
        if (value !== undefined && value !== '') {
            accepted = await secrets.save(data.endpointId, data.request.requestId, value);
        } else if (declined) {
            accepted = await secrets.decline(data.endpointId, data.request.requestId);
        }
    } else if (action.kind === 'choose' && isComputerChoice(action.choiceId)) {
        accepted = await answerComputer(data.request.requestId, action.choiceId);
    }
    if (!accepted) {
        throw new Error(i18next.t('prompts:error.expired'));
    }
}
