import type { PromptViewProps } from '@adecore/agents-react/prompts';
import { ApprovalActions, PromptPrimary, PromptCard } from '@adecore/agents-react/prompts';
import { Button, Input, ScrollArea } from '@adecore/ui';
import type { ProjectProposal, SecretRequest } from '@ruimte/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isRuimteApp } from '@/computer/ruimte-app';
import { computerButtons, SECRET_ANSWER_FIELD, SECRET_DECLINE, type RuimtePrompt } from '@/prompts/ruimte-prompts';
import { useUi } from '@/state/ui';

/* A card of Ruimte's own, drawn the way a chat draws its prompts: a waiting terminal, the machine asking to let an agent into an app, or an agent asking for a launch's secret. */
export function RuimtePromptView({ prompt, props }: { prompt: RuimtePrompt; props: PromptViewProps }) {
    const { t } = useTranslation('prompts');
    const { onAction, disabled, sending, error, top, onReveal } = props;
    const { data } = prompt;

    if (data.kind === 'terminal-waiting') {
        return (
            <PromptCard
                kind="waiting"
                heading={data.request ? t(`waiting.${data.request.kind}`, { tool: data.request.toolName }) : t('waiting.heading')}
                top={top}
                busy={false}
                notice={null}
                error={null}
                actions={
                    <div className="ml-auto flex items-center">
                        <PromptPrimary onClick={onReveal}>{t('waiting.goToTerminal')}</PromptPrimary>
                    </div>
                }
            >
                {data.request?.title && <p className="text-sm text-text">{data.request.title}</p>}
                {data.request?.text && (
                    <ScrollArea
                        render={<pre />}
                        className="max-h-64"
                        viewportClassName="whitespace-pre-wrap break-words font-mono text-xs text-text select-text"
                    >
                        {data.request.text}
                    </ScrollArea>
                )}
                <p className="text-sm text-text-muted">{t('waiting.body')}</p>
            </PromptCard>
        );
    }

    if (data.kind === 'secret-request') {
        // Keyed on the request, so a field never carries what was typed for one card into the next.
        return <SecretCard key={data.request.requestId} request={data.request} props={props} />;
    }

    if (data.kind === 'project-proposal') {
        return <ProposalCard proposal={data.proposal} props={props} />;
    }

    const { request } = data;
    const locked = sending || disabled;
    const buttons = computerButtons().map(({ action, ...button }) => ({ ...button, onPress: () => onAction(action) }));
    const words = { node: request.nodeTitle?.trim() || t('computer.unnamed'), project: request.projectName ?? '', app: request.app.name };
    return (
        <PromptCard
            kind="approval"
            heading={t('computer.heading', { app: request.app.name })}
            top={top}
            busy={sending}
            notice={disabled ? t('error.notConnected') : null}
            error={error}
            actions={<ApprovalActions buttons={buttons} locked={locked} sending={sending} />}
        >
            <p className="text-sm text-text">{request.projectName === null ? t('computer.bodyNoProject', words) : t('computer.body', words)}</p>
            <p className="break-all font-mono text-xs text-text-muted select-text">{request.app.bundleId}</p>
            <p className="text-xs text-text-muted">{t('computer.scope', { app: request.app.name })}</p>
            {isRuimteApp(request.app.bundleId) && <p className="text-xs text-text-muted">{t('computer.ruimte')}</p>}
        </PromptCard>
    );
}

/*
 * The value lives in this card's own state only, never in the stack's draft, and is cleared the
 * moment it is sent: a failed send asks for it again rather than keeping it around.
 */
function SecretCard({ request, props }: { request: SecretRequest; props: PromptViewProps }) {
    const { t } = useTranslation('prompts');
    const { onAction, disabled, sending } = props;
    const [value, setValue] = useState('');
    const locked = sending || disabled;
    const words = { launch: request.launchName, variable: request.variable };

    const save = (event?: FormEvent): void => {
        event?.preventDefault();
        if (locked || value === '') {
            return;
        }
        const sent = value;
        setValue('');
        onAction({ kind: 'answer', answers: { [SECRET_ANSWER_FIELD]: sent } });
    };

    return (
        <QuestionCard
            props={props}
            heading={request.label}
            decline={t('secret.decline')}
            primary={{ label: t('secret.save'), disabled: value === '', onClick: () => save() }}
        >
            <p className="text-sm text-text">{t('secret.body', words)}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-text-muted">{request.reason}</p>
            <form onSubmit={save}>
                <Input
                    data-prompt-entry
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    mono
                    aria-label={t('secret.field')}
                    placeholder={request.placeholder ?? t('secret.field')}
                    disabled={locked}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                />
            </form>
            <p className="text-xs text-text-muted">{t('secret.variable', words)}</p>
            {request.replaces && <p className="text-xs text-text-muted">{t('secret.replaces', words)}</p>}
            <p className="text-xs text-text-muted">{t('secret.approval')}</p>
        </QuestionCard>
    );
}

/* An agent in Chats thinks its chat has become a project. The card only asks; the dialog that moves a chat does the rest. */
function ProposalCard({ proposal, props }: { proposal: ProjectProposal; props: PromptViewProps }) {
    const { t } = useTranslation('prompts');

    const review = (): void => {
        useUi.getState().setMoveChatDialog({
            chatId: proposal.chatId,
            mode: 'make',
            projectId: null,
            suggest: { name: proposal.name, ...(proposal.folder === undefined ? {} : { folder: proposal.folder }) }
        });
    };

    return (
        <QuestionCard
            props={props}
            heading={t('projectProposal.title')}
            decline={t('projectProposal.decline')}
            primary={{ label: t('projectProposal.review'), disabled: false, onClick: review }}
        >
            <p className="break-words text-sm text-text">{proposal.name}</p>
            {proposal.folder !== undefined && <p className="break-all font-mono text-xs text-text-muted select-text">{proposal.folder}</p>}
            <p className="whitespace-pre-wrap break-words text-sm text-text-muted">{proposal.reason}</p>
        </QuestionCard>
    );
}

interface QuestionCardProps {
    props: PromptViewProps;
    heading: string;
    decline: string;
    primary: { label: string; disabled: boolean; onClick(): void };
    children: ReactNode;
}

/* A question of Ruimte's own: Decline goes to the machine, the primary is the card's own answer. */
function QuestionCard({ props, heading, decline, primary, children }: QuestionCardProps) {
    const { t } = useTranslation('prompts');
    const { onAction, disabled, sending, error, top } = props;
    const locked = sending || disabled;
    return (
        <PromptCard
            kind="question"
            heading={heading}
            top={top}
            busy={sending}
            notice={disabled ? t('error.notConnected') : null}
            error={error}
            actions={
                <>
                    <Button size="sm" disabled={locked} onClick={() => onAction({ kind: 'choose', choiceId: SECRET_DECLINE })}>
                        {decline}
                    </Button>
                    <span className="grow" />
                    <PromptPrimary disabled={locked || primary.disabled} onClick={primary.onClick}>
                        {primary.label}
                    </PromptPrimary>
                </>
            }
        >
            {children}
        </PromptCard>
    );
}
