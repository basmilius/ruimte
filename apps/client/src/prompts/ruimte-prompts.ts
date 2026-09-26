import i18next from 'i18next';
import type { ComputerApproval, ComputerApprovalChoice } from '@ruimte/contracts';
import type { PromptAction } from '@ruimte/agents-react/prompts/logic/prompts';
import type { ApprovalButtonSpec, HostPrompt, PromptSubject } from '@ruimte/agents-react/prompts/logic/subjects';

/*
 * What Ruimte asks beside a chat's own prompts: the machine's approval for an agent to operate an app,
 * which the machine asks and not the CLI, and a terminal whose TUI waits, which only the TUI answers.
 */
export type RuimtePromptData = { kind: 'computer-approval'; request: ComputerApproval } | { kind: 'terminal-waiting'; since: number };

export interface RuimtePrompt extends HostPrompt {
    data: RuimtePromptData;
}

const COMPUTER_CHOICES: readonly string[] = ['once', 'always', 'deny'] satisfies ComputerApprovalChoice[];

const isComputerChoice = (choiceId: string): choiceId is ComputerApprovalChoice => COMPUTER_CHOICES.includes(choiceId);

export const computerPrompt = (nodeId: string, request: ComputerApproval): RuimtePrompt => ({
    id: `computer:${nodeId}:${request.requestId}`,
    createdAt: request.createdAt,
    blocking: true,
    asks: 'approval',
    data: { kind: 'computer-approval', request }
});

export const waitingPrompt = (nodeId: string, since: number): RuimtePrompt => ({
    id: `waiting:${nodeId}`,
    createdAt: since,
    blocking: true,
    asks: 'approval',
    data: { kind: 'terminal-waiting', since }
});

export const isRuimtePrompt = (prompt: HostPrompt): prompt is RuimtePrompt => {
    const data = prompt.data as Partial<RuimtePromptData> | null;
    return data?.kind === 'computer-approval' || data?.kind === 'terminal-waiting';
};

/* What a card is about, which stays the same object while it waits, so a stack that reads the same draws nothing again. */
export const ruimtePayloadOf = (subject: PromptSubject): unknown => {
    if (subject.kind === 'chat') {
        return subject.item;
    }
    if (!isRuimtePrompt(subject.prompt)) {
        return subject.prompt.data;
    }
    const { data } = subject.prompt;
    return data.kind === 'computer-approval' ? data.request : data.since;
};

/* The buttons of an approval to operate an app: Deny, Always allow, and Allow this time as the primary. */
export const computerButtons = (): ApprovalButtonSpec[] => {
    const choose = (choiceId: ComputerApprovalChoice) => ({ kind: 'choose', choiceId }) as const;
    return [
        { id: 'deny', label: i18next.t('prompts:computer.deny'), primary: false, action: choose('deny') },
        { id: 'always', label: i18next.t('prompts:computer.always'), primary: false, action: choose('always') },
        { id: 'once', label: i18next.t('prompts:computer.once'), primary: true, action: choose('once') }
    ];
};

/*
 * Sends a card's choice to the machine, which says whether it still waited. A waiting terminal is
 * answered only in its TUI, so it sends nothing.
 */
export const answerRuimtePrompt = async (
    prompt: HostPrompt,
    action: PromptAction,
    answerComputer: (requestId: string, choice: ComputerApprovalChoice) => Promise<boolean>
): Promise<void> => {
    if (!isRuimtePrompt(prompt) || prompt.data.kind === 'terminal-waiting' || action.kind !== 'choose') {
        throw new Error(i18next.t('prompts:error.terminalOnly'));
    }
    if (!isComputerChoice(action.choiceId) || !(await answerComputer(prompt.data.request.requestId, action.choiceId))) {
        throw new Error(i18next.t('prompts:error.expired'));
    }
};
