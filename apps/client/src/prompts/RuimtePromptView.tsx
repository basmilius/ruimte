import type { PromptViewProps } from '@adecore/agents-react/prompts';
import { ApprovalActions, PromptPrimary, PromptCard } from '@adecore/agents-react/prompts';
import { Button, Icon, Input, ScrollArea, Spinner } from '@adecore/ui';
import type { ProjectProposal, SecretRequest, TunnelProposal } from '@ruimte/contracts';
import type { TFunction } from 'i18next';
import { TriangleAlert } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isRuimteApp } from '@/computer/ruimte-app';
import { moveChatDialog } from '@/project/dialogs';
import { computerButtons, SECRET_ANSWER_FIELD, SECRET_DECLINE, TUNNEL_CONFIRM, tunnelProposalHeading, type RuimtePrompt } from '@/prompts/ruimte-prompts';

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

    if (data.kind === 'tunnel-proposal') {
        return <TunnelProposalCard proposal={data.proposal} props={props} />;
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
        moveChatDialog.set({
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

function originLine(proposal: TunnelProposal, t: TFunction<'prompts'>): string | null {
    const parts = [
        ...(proposal.origin?.https === true ? ['https'] : []),
        ...(proposal.origin?.hostHeader === undefined ? [] : [t('tunnelProposal.hostHeader', { header: proposal.origin.hostHeader })])
    ];

    return parts.length === 0 ? null : parts.join(' · ');
}

/*
 * An agent suggests a change to a hostname of the machine's tunnel. Confirm makes the change Settings would make, and
 * Cloudflare takes seconds to answer; a card whose hostname changed since can only be declined.
 */
function TunnelProposalCard({ proposal, props }: { proposal: TunnelProposal; props: PromptViewProps }) {
    const { t } = useTranslation('prompts');
    const { onAction, sending } = props;
    const origin = proposal.kind === 'dev' && proposal.action !== 'off' && proposal.action !== 'remove' ? originLine(proposal, t) : null;
    // Settings warns before a dev server goes public, so a card that would make one public warns the same way.
    const exposes = proposal.kind === 'dev' && (proposal.action === 'add' || proposal.action === 'on');

    return (
        <QuestionCard
            props={props}
            heading={tunnelProposalHeading(proposal)}
            decline={t('tunnelProposal.decline')}
            primary={{
                label: sending ? t('tunnelProposal.confirming') : t('tunnelProposal.confirm'),
                disabled: proposal.stale,
                busy: sending,
                onClick: () => onAction({ kind: 'choose', choiceId: TUNNEL_CONFIRM })
            }}
        >
            {origin !== null && <p className="break-all font-mono text-xs text-text-muted select-text">{origin}</p>}
            {proposal.reason !== undefined && <p className="whitespace-pre-wrap break-words text-sm text-text-muted">{proposal.reason}</p>}
            {exposes && !proposal.stale && (
                <p className="flex items-center gap-2 text-xs text-status-needs-you">
                    <Icon icon={TriangleAlert} size={14} className="shrink-0" />
                    {t('settings:tunnels.add.devWarning')}
                </p>
            )}
            {proposal.stale && <p className="text-xs text-status-needs-you">{t('tunnelProposal.stale', { hostname: proposal.hostname })}</p>}
        </QuestionCard>
    );
}

interface QuestionCardProps {
    props: PromptViewProps;
    heading: string;
    decline: string;
    primary: { label: string; disabled: boolean; busy?: boolean; onClick(): void };
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
                        {primary.busy === true && <Spinner size={14} />}
                        {primary.label}
                    </PromptPrimary>
                </>
            }
        >
            {children}
        </PromptCard>
    );
}
