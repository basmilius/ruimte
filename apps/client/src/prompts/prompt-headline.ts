import i18next from 'i18next';
import { toolSummary } from '@adecore/agents-react/chat';
import type { PromptSubject } from '@adecore/agents-react/prompts';
import { isRuimtePrompt } from '@/prompts/ruimte-prompts';

/*
 * What a prompt asks, as one line for the folded stack: the words its card is headed with, so the
 * bar and the card never say different things.
 */
export function promptHeadline(subject: PromptSubject): string {
    if (subject.kind === 'chat') {
        const { item } = subject;
        if (item.kind === 'question') {
            return item.questions[0]?.question ?? '';
        }
        return [item.toolName, toolSummary(item.toolName, item.input)].filter((part) => part !== '').join(' ');
    }
    if (!isRuimtePrompt(subject.prompt)) {
        return '';
    }
    const { data } = subject.prompt;
    if (data.kind === 'computer-approval') {
        return i18next.t('prompts:computer.heading', { app: data.request.app.name });
    }
    if (data.kind === 'secret-request') {
        return data.request.label;
    }
    if (data.kind === 'project-proposal') {
        return i18next.t('prompts:projectProposal.title');
    }
    if (data.request?.title) {
        return data.request.title;
    }
    return data.request ? i18next.t(`prompts:waiting.${data.request.kind}`, { tool: data.request.toolName }) : i18next.t('prompts:waiting.heading');
}
