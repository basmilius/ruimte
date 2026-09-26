import { useTranslation } from 'react-i18next';
import type { PromptViewProps } from '@ruimte/agents-react/prompts/logic/subjects';
import { ApprovalActions, PromptPrimary } from '@ruimte/agents-react/prompts/ui/PromptActions';
import { PromptCard } from '@ruimte/agents-react/prompts/ui/PromptCard';
import { isRuimteApp } from '@/computer/ruimte-app';
import { computerButtons, type RuimtePrompt } from '@/prompts/ruimte-prompts';

/* A card of Ruimte's own, drawn the way a chat draws its prompts: a waiting terminal, or the machine asking to let an agent into an app. */
export function RuimtePromptView({ prompt, props }: { prompt: RuimtePrompt; props: PromptViewProps }) {
    const { t } = useTranslation('prompts');
    const { onAction, disabled, sending, error, top, onReveal } = props;
    const { data } = prompt;

    if (data.kind === 'terminal-waiting') {
        return (
            <PromptCard
                kind="waiting"
                heading={t('waiting.heading')}
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
                <p className="text-sm text-text-muted">{t('waiting.body')}</p>
            </PromptCard>
        );
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
